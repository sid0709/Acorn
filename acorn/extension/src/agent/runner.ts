/**
 * An application Run driven by the agent server. The loop is the same at every step: look
 * at the page (a screenshot, and what the page says about the focused control), send it to
 * the server, perform the actions it sends back, and look again. The server remembers the
 * run and judges whether each action did what it meant; this side only sees and acts.
 */

import {
  AGENT_ERROR_CODE,
  AGENT_STATUS,
  type AgentAction,
  type AgentAsk,
  type AgentSurveyScreen,
  type AgentActionResult,
  type AgentStep,
  type AgentUsage,
} from "@acorn/shared/agent-contract";
import { VERIFICATION } from "@acorn/shared/run-types";
import {
  RUN_FAILURE_REASON,
  RUN_OUTCOME,
  RUN_STAGE,
  type MailSearch,
  type RunFailure,
  type RunReport,
} from "@acorn/shared/run-types";

import { RunLog, logUrl } from "../pipeline/run-log";

import { captureShot, type Shot } from "./capture";
import {
  AgentApiError,
  continueSession,
  endSession,
  fetchResumeFile,
  isRetryable,
  sendStep,
  startSession,
  vetTarget,
} from "./client";
import { CHANGES_THE_PAGE, runActions, type ExecutorContext } from "./executor";
import { createClickGuard, createFrameSweep, describeWindow, watchFrameEvents } from "./guard";
import { afterLook, foundIn, lookLogFields, missed, startMailSearch } from "./mail-search";
import {
  isEmailVerificationStop,
  noteForVerification,
  verificationKindFor,
  waitForMailVerification,
} from "./mail-verification";
import { readFocus, readPageText } from "./page-info";
import {
  agentRunState,
  endProgress,
  failureFromError,
  failureFromStatus,
  runningProgress,
  AGENT_EXPIRED_MESSAGE,
  AGENT_STARTING_MESSAGE,
} from "./progress";
import { scrollToTop } from "./scroll-top";
import { AGENT_SURVEY } from "./settings";
import { captureSurvey } from "./survey";
import { openAgentTab, type AgentTab } from "./tab-session";
import { recordAgentTrace } from "./trace-log";
import { toBase64, type ResumeFile } from "./upload";

import type { KeptRun } from "./kept-run";
import type { PipelineProgress } from "@acorn/shared/pipeline-types";

/** The most times one step is sent again when the model is busy or briefly down. */
export const STEP_RETRY_LIMIT = 3;
/** Waits between those retries, in order. */
export const STEP_RETRY_BACKOFF_MS = [2_000, 6_000, 15_000] as const;
/** How long a tab the page opened gets to show an address before the run goes on in it. */
export const NEW_TAB_WAIT_MS = 8_000;
/** What the overlay's bar says while the agent waits for the person's answer. */
export const ASK_LABEL = "Acorn has a question for you in the sidebar";
/** What the overlay's bar says while the agent works. */
export const OVERLAY_LABEL = "Acorn is applying on this page";

/** How a look in Gmail for a code or link ended. */
const GMAIL_READ = { found: "found", noMailbox: "no_mailbox", missed: "missed" } as const;
type GmailRead = (typeof GMAIL_READ)[keyof typeof GMAIL_READ];

/** Raised inside the run when the person stops it. */
class StoppedError extends Error {
  constructor() {
    super("stopped");
    this.name = "StoppedError";
  }
}

export interface AgentRunArgs {
  tabId: number;
  /** Where acorn-agent runs. */
  agentUrl: string;
  /** Aborts when the person presses Stop in the sidebar. */
  signal: AbortSignal;
  stopBeforeSubmit: boolean;
  /** Survey long pages for this run; the default is AGENT_SURVEY (off). */
  survey?: boolean;
  /** The person's own OpenRouter key, when the extension holds one; the server has its own otherwise. */
  key?: string;
  /** The person's Acorn session: the agent reads their profile and résumés from acorn-backend with it. */
  accessToken?: string;
  emit: (tabIds: number[], progress: PipelineProgress) => void;
  /** The run went on in another tab: Stop and progress follow it. */
  claimTab?: (tabId: number) => void;
  /** Waits between a step's retries; the defaults unless a test shortens them. */
  retryBackoffMs?: readonly number[];
  /**
   * Waits for the person's answer (an option id) to a question the agent asks. It rejects
   * when the signal aborts. A run without it cannot ask, so a question ends it.
   */
  waitForAnswer?: (signal: AbortSignal) => Promise<string>;
  /**
   * A stopped run to take back up: the agent still holds its memory, so the run goes on in the same
   * conversation instead of starting over. If the agent has forgotten it, the run starts over.
   */
  resume?: KeptRun;
  /**
   * Keeps a run that stopped (the person pressed Stop, it needed them, or the connection dropped)
   * so Continue can take it back up. Without it, a run that stops is ended on the server.
   */
  keepRun?: (tabIds: number[], run: KeptRun) => Promise<void>;
}

/** Whether a failure leaves the run's memory on the server for Continue: not when it is gone. */
function runSurvives(err: unknown): boolean {
  return !(err instanceof AgentApiError && err.code === AGENT_ERROR_CODE.noSession);
}

/** A short fingerprint of a page's text, to send it only when it changed. */
export function textFingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${text.length}:${hash}`;
}

/** One line for the log: what an action is, never what it typed. */
export function describeAction(action: AgentAction): string {
  switch (action.kind) {
    case "type":
      return `type (${[...(action.text ?? "")].length} characters${action.secret ? ", secret" : ""})`;
    case "key":
      return `key ${action.keys ?? ""}`;
    case "scroll":
      return `scroll ${Math.round(action.dx ?? 0)},${Math.round(action.dy ?? 0)}`;
    case "wait":
      return `wait ${action.ms ?? 0}ms`;
    case "upload":
      return `upload ${action.fileName ?? action.resume ?? ""} at ${Math.round(action.x ?? 0)},${Math.round(action.y ?? 0)}`;
    default:
      return `${action.kind} at ${Math.round(action.x ?? 0)},${Math.round(action.y ?? 0)}`;
  }
}

/** A wait the Stop button cuts short. */
function sleeper(signal: AbortSignal) {
  return (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new StoppedError());
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new StoppedError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
}

export async function runAgent(args: AgentRunArgs): Promise<RunReport> {
  const surveyOn = args.survey ?? AGENT_SURVEY;
  // A continued run writes to the same log and trace folder as the run it takes up.
  const runId = args.resume?.runId ?? crypto.randomUUID().slice(0, 8);
  const workTabId = args.resume?.tabId ?? args.tabId;
  const startedAt = Date.now();
  const log = new RunLog(runId, args.tabId);
  const local = new AbortController();
  const signal = AbortSignal.any([args.signal, local.signal]);
  const sleep = sleeper(signal);
  const checkStopped = () => {
    if (signal.aborted) throw new StoppedError();
  };

  const tabs: number[] = [args.tabId];
  let current: AgentTab | null = null;
  let sessionId: string | null = null;
  /** Set when the run ends in a way Continue can take up again: the server keeps its memory. */
  let keepSession = false;
  // A continued run keeps what it was started with: the agent's prompt was fixed then.
  let stopBeforeSubmit = args.resume?.stopBeforeSubmit ?? args.stopBeforeSubmit;
  let shot: Shot | null = null;
  let tabClosed = false;
  let lastUsage: AgentUsage | null = null;
  let stepNumber = 0;
  /**
   * When the last actions that change a page began (a click, typing, a key, an upload): a site
   * sends its code or link in answer to one of these, so only mail from after it can be the site's.
   * A wait or a scroll does not count, or the email could arrive before the time it is looked for from.
   */
  let lastChangeAt = startedAt;
  /** What the run is reading in Gmail, shown on the Now card; kept after the code is found. */
  let mailSearch: MailSearch | undefined;
  const MAIL_VERIFY_WINDOW_MS = 10 * 60 * 1000;
  let pendingTab: number | null = null;
  let pageUrl = "";
  /** Notes from things that happened between looks (a frame the guard closed), told on the next look. */
  const pendingNotes: string[] = [];
  const frames: { stop: (() => void) | null; sweep: () => Promise<void> } = {
    stop: null,
    sweep: async () => {},
  };
  const files = new Map<string, Promise<ResumeFile>>();
  const vet = (target: Parameters<typeof vetTarget>[2]) =>
    vetTarget(args.agentUrl, must(sessionId), target, signal);
  const clickGuard = createClickGuard({
    cdp: () => must(current).cdp,
    vet,
    pageUrl: () => pageUrl,
  });
  /** Judges the frames of another origin that appear in the tab the run is in. */
  const watchFrames = (tab: AgentTab) => {
    const deps = {
      cdp: tab.cdp,
      vet,
      pageUrl: () => pageUrl,
      onClosed: (note: string) => {
        pendingNotes.push(note);
        log.event("agent-guard", { closed: "frame" });
      },
    };
    frames.stop?.();
    frames.sweep = createFrameSweep(deps);
    frames.stop = watchFrameEvents(tab.cdp, () => frames.sweep());
  };

  const emit = (progress: PipelineProgress) => args.emit(tabs, progress);
  const runState = (control?: string, ask?: AgentAsk) =>
    agentRunState({
      runId,
      startedAt,
      step: stepNumber,
      control,
      usage: lastUsage,
      ask,
      mail: mailSearch,
    });

  /**
   * Reads the applicant's Gmail for the code or link the site said it sent, showing what is read.
   * When it finds one the agent takes the run back up, told the value on its next look.
   */
  const readGmail = async (
    step: AgentStep,
    info: { url?: string; title?: string },
    pageText: string,
    here: AgentTab,
  ): Promise<GmailRead> => {
    const kind = verificationKindFor(step.stop);
    mailSearch = startMailSearch(kind, lastChangeAt);
    log.event("mail-verification:start", { kind, since: lastChangeAt });
    const showSearch = () =>
      emit(
        runningProgress(
          { ...runState(), stage: RUN_STAGE.verifying },
          step.message || "Reading your Gmail for the verification…",
        ),
      );
    showSearch();
    void here.overlay.setLabel("Reading your Gmail for the verification…");
    const outcome = await waitForMailVerification({
      runId,
      step: step.number,
      kind,
      url: info.url ?? "",
      title: info.title ?? "",
      pageText,
      sinceMs: lastChangeAt,
      windowMs: MAIL_VERIFY_WINDOW_MS,
      signal,
      onLook: (response) => {
        if (!mailSearch) return;
        mailSearch = afterLook(mailSearch, response.ok ? response.emails : undefined);
        log.event("mail-verification:look", lookLogFields(mailSearch, response.model));
        showSearch();
      },
    });
    if (outcome.ok) {
      mailSearch = foundIn(mailSearch, outcome.messageId);
      log.event("mail-verification:found", { kind: outcome.kind, messageId: outcome.messageId });
      showSearch();
      await continueSession(args.agentUrl, must(sessionId));
      keepSession = false;
      if (outcome.kind === VERIFICATION.emailLink) {
        await chrome.tabs.update(here.tabId, { url: outcome.value });
      }
      pendingNotes.push(noteForVerification(outcome.kind, outcome.value));
      lastChangeAt = Date.now();
      void here.overlay.setLabel(OVERLAY_LABEL);
      return GMAIL_READ.found;
    }
    mailSearch = missed(mailSearch, outcome.reason === "error" ? outcome.detail : outcome.reason);
    log.event("mail-verification:miss", { reason: outcome.reason, detail: outcome.detail });
    return outcome.reason === "no_mailbox" ? GMAIL_READ.noMailbox : GMAIL_READ.missed;
  };

  const onCreated = (tab: chrome.tabs.Tab) => {
    if (tab.openerTabId === current?.tabId && tab.id != null) pendingTab = tab.id;
  };
  chrome.tabs.onCreated.addListener(onCreated);

  const hooks = {
    onStop: () => local.abort(),
    onTabClosed: () => {
      tabClosed = true;
      local.abort();
    },
  };

  const executor: ExecutorContext = {
    get cdp() {
      return must(current).cdp;
    },
    get overlay() {
      return must(current).overlay;
    },
    scale: () => shot?.scale ?? 1,
    resume: (id, fileName) => {
      let file = files.get(id);
      if (!file) {
        file = fetchResumeFile(args.agentUrl, must(sessionId), id, fileName, signal, toBase64);
        files.set(id, file);
        file.catch(() => files.delete(id));
      }
      return file;
    },
    sleep,
    checkStopped,
    guard: clickGuard,
    afterClick: () => frames.sweep(),
  };

  /** Moves the run into the tab the page opened, so the application goes on where it went. */
  const followNewTab = async (id: number): Promise<string> => {
    const deadline = Date.now() + NEW_TAB_WAIT_MS;
    let tab = await chrome.tabs.get(id);
    while (!tab.url && Date.now() < deadline) {
      await sleep(200);
      tab = await chrome.tabs.get(id);
    }
    // A window a click opened is judged before the run goes into it: an online file source or a
    // sign-in to one is closed, and the run stays where it was.
    try {
      const verdict = await vet(await describeWindow(id, pageUrl));
      if (verdict.blocked) {
        await chrome.tabs.remove(id).catch(() => undefined);
        log.event("agent-guard", { closed: "window" });
        return "A click opened a window for an online file source or a sign-in to one, and Acorn closed it. Acorn never uses those: attach a file with upload, at the button that opens this computer's file picker.";
      }
    } catch {
      // A window that cannot be judged is followed, as before.
    }
    const previous = must(current);
    current = await openAgentTab(id, hooks, OVERLAY_LABEL);
    watchFrames(current);
    await previous.close();
    tabs.push(id);
    log.moveTo(id);
    args.claimTab?.(id);
    log.event("agent-new-tab", { tabId: id });
    return `The page opened a new tab and the run moved into it. You are now working in the new tab; the old one is still open.`;
  };

  const askWithRetry = async (observation: Parameters<typeof sendStep>[2]): Promise<AgentStep> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await sendStep(args.agentUrl, must(sessionId), observation, signal);
      } catch (err) {
        checkStopped();
        if (!isRetryable(err) || attempt >= STEP_RETRY_LIMIT) throw err;
        log.event("agent-step:retry", {
          attempt: attempt + 1,
          code: err instanceof AgentApiError ? err.code : "",
        });
        const backoff = args.retryBackoffMs ?? STEP_RETRY_BACKOFF_MS;
        await sleep(backoff[Math.min(attempt, backoff.length - 1)]);
      }
    }
  };

  const finish = (report: RunReport, resumable = false): RunReport => {
    chrome.tabs.onCreated.removeListener(onCreated);
    keepSession = resumable && Boolean(sessionId) && Boolean(args.keepRun);
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    log.event("run:end", {
      outcome: report.outcome,
      steps: stepNumber,
      seconds,
      reason: report.failure?.reason,
      detail: report.failure?.detail,
      calls: lastUsage?.calls,
      costUsd: lastUsage?.cost,
    });
    emit(
      endProgress({
        run: runState(),
        report,
        steps: stepNumber,
        startedAt,
        usage: lastUsage,
        canContinue: keepSession,
      }),
    );
    return report;
  };

  const report = (outcome: RunReport["outcome"], failure?: RunFailure): RunReport => ({
    outcome,
    pages: 1,
    refills: 0,
    failure,
  });

  try {
    emit(runningProgress(runState(), AGENT_STARTING_MESSAGE));
    // Continue may be pressed on a tab the run was not working in last: it goes on where it was.
    if (workTabId !== args.tabId) {
      tabs.push(workTabId);
      log.moveTo(workTabId);
      args.claimTab?.(workTabId);
    }
    const tab = await chrome.tabs.get(workTabId);
    log.event("agent-start", {
      tabId: workTabId,
      url: logUrl(tab.url ?? ""),
      stopBeforeSubmit,
      continued: Boolean(args.resume),
    });
    current = await openAgentTab(workTabId, hooks, OVERLAY_LABEL);
    watchFrames(current);
    if (args.resume) {
      // Held from now on, so a Continue that fails for want of the network can be tried again.
      sessionId = args.resume.sessionId;
      try {
        const continued = await continueSession(args.agentUrl, sessionId);
        stepNumber = continued.number;
        lastUsage = continued.usage;
        log.step = continued.number;
        log.event("agent-continue", { step: continued.number, calls: continued.usage.calls });
      } catch (err) {
        // A run the agent forgot (it expired, or the server restarted) cannot be continued: start over.
        if (!(err instanceof AgentApiError && err.code === AGENT_ERROR_CODE.noSession)) throw err;
        log.event("agent-continue:lost", { sessionId: args.resume.sessionId });
        sessionId = null;
        stopBeforeSubmit = args.stopBeforeSubmit;
        emit(runningProgress(runState(), AGENT_EXPIRED_MESSAGE));
      }
    }
    if (!sessionId) {
      const started = await startSession(
        args.agentUrl,
        {
          url: tab.url ?? "",
          title: tab.title ?? "",
          stopBeforeSubmit,
          trace: true,
          survey: surveyOn,
        },
        args.key,
        args.accessToken,
      );
      sessionId = started.sessionId;
      log.event("agent-session", { resumes: started.resumes.length });
      recordAgentTrace(log, started.trace);
    }

    let results: AgentActionResult[] = [];
    let carriedNotes: string[] = [];
    let answer: string | undefined;
    let sentText = "";
    // With surveys on (AGENT_SURVEY), the first look of a page is a survey of the whole of it, so
    // the model can plan the form at once; so is the look after the model asks for one.
    let surveyNext = surveyOn;
    let lastLook = "";
    for (;;) {
      checkStopped();
      if (pendingTab != null) {
        const id = pendingTab;
        pendingTab = null;
        carriedNotes.push(await followNewTab(id));
      }
      const here = must(current);
      // A frame an online file source drew over the page is gone before the screenshot is taken.
      await frames.sweep();
      await here.overlay.ensure();
      const info = await chrome.tabs.get(here.tabId);
      const lookKey = `${info.url ?? ""}\n${info.title ?? ""}`;
      const newPage = lookKey !== lastLook;
      const surveying = surveyOn && (surveyNext || newPage);
      surveyNext = false;
      lastLook = lookKey;
      // A page is first looked at from its top: a run that starts, or a click that opens another page,
      // must not begin in the middle of a form whose first questions lie above the screen.
      if (newPage) await scrollToTop(here.cdp, sleep);
      let survey: AgentSurveyScreen[] | null = null;
      const captureStartedAt = Date.now();
      await here.overlay.hideForCapture(true);
      try {
        shot = await captureShot(here.cdp);
        if (surveying) {
          survey = await captureSurvey({ cdp: here.cdp, sleep, checkStopped }, shot).catch(
            (err: unknown) => {
              if (signal.aborted) throw err;
              return null; // a page that cannot be surveyed is looked at one screen at a time
            },
          );
        }
      } finally {
        await here.overlay.hideForCapture(false);
      }
      const captureMs = Date.now() - captureStartedAt;
      checkStopped();
      if (survey) log.event("agent-survey", { screens: survey.length });
      const [focus, text] = await Promise.all([
        readFocus(here.cdp),
        readPageText(here.cdp, here.tabId),
      ]);
      // The page's text goes once per change: the job description may sit above the form,
      // where a click on Apply has already scrolled past it.
      const fingerprint = text ? textFingerprint(text) : "";
      const pageText = fingerprint && fingerprint !== sentText ? text : undefined;
      if (pageText) sentText = fingerprint;
      const answered = answer;
      answer = undefined;
      pageUrl = info.url ?? "";
      const notes = [...carriedNotes, ...pendingNotes.splice(0), ...here.takeNotes()];
      carriedNotes = [];

      const askedAt = Date.now();
      const step = await askWithRetry({
        screenshot: shot.dataUrl,
        url: info.url ?? "",
        title: info.title ?? "",
        viewport: shot.viewport,
        focus,
        notes,
        results,
        ...(survey ? { survey } : {}),
        ...(pageText ? { pageText } : {}),
        ...(answered ? { answer: answered } : {}),
      });
      checkStopped();
      stepNumber = step.number;
      lastUsage = step.usage;
      const actions = step.actions ?? [];
      if (step.survey) surveyNext = true;
      log.step = step.number;
      recordAgentTrace(log, step.trace, {
        seq: step.trace?.seq ?? step.number,
        screenshot: shot.dataUrl,
        survey: survey ?? undefined,
      });
      log.event("agent-step", {
        number: step.number,
        status: step.status,
        message: step.message,
        actions: actions.map(describeAction),
        dropped: step.dropped,
        ms: Date.now() - askedAt,
        captureMs,
        calls: step.usage.calls,
        costUsd: step.usage.cost,
        url: logUrl(info.url ?? ""),
      });
      emit(
        runningProgress(
          runState(actions[0] ? describeAction(actions[0]) : undefined),
          step.message || "Working…",
        ),
      );
      void here.overlay.setLabel(step.message || OVERLAY_LABEL);

      if (step.status === AGENT_STATUS.needPerson && isEmailVerificationStop(step.stop?.reason)) {
        const gmail = await readGmail(step, info, text, here);
        if (gmail === GMAIL_READ.found) {
          results = [];
          continue;
        }
        if (gmail === GMAIL_READ.noMailbox) {
          return finish(
            report(RUN_OUTCOME.failed, {
              reason: RUN_FAILURE_REASON.mailUnreadable,
              label: "Gmail is not connected",
              detail: "Connect Gmail on the Acorn website, then press Continue.",
              stage: RUN_STAGE.verifying,
            }),
            true,
          );
        }
      }

      if (step.status === AGENT_STATUS.ask && step.ask) {
        const ask = step.ask;
        log.event("agent-ask", { id: ask.id, options: ask.options.map((option) => option.id) });
        if (!args.waitForAnswer) throw new Error("the run cannot ask a question here");
        emit(runningProgress(runState(undefined, ask), ask.question));
        void here.overlay.setLabel(ASK_LABEL);
        answer = await args.waitForAnswer(signal);
        checkStopped();
        log.event("agent-answer", { id: ask.id, answer });
        results = [];
        void here.overlay.setLabel(OVERLAY_LABEL);
        continue;
      }

      if (step.status !== AGENT_STATUS.working) {
        log.decision(
          `agent:${step.status}`,
          step.message,
          { step: step.number },
          step.status === AGENT_STATUS.done ? undefined : "warn",
        );
        // A run that ends may first scroll what the person must act on into view.
        if (actions.length > 0) await runActions(executor, actions);
        if (step.status === AGENT_STATUS.done) {
          return finish(
            report(stopBeforeSubmit ? RUN_OUTCOME.readyToSubmit : RUN_OUTCOME.completed),
          );
        }
        return finish(
          report(RUN_OUTCOME.failed, failureFromStatus(step.status, step.message, step.stop)),
          true,
        );
      }

      const actionsBeganAt = Date.now();
      results = await runActions(executor, actions);
      for (const result of results) {
        if (!result.ok) log.event("agent-action:failed", { id: result.id, error: result.error });
      }
      if (actions.some((action) => CHANGES_THE_PAGE.has(action.kind)))
        lastChangeAt = actionsBeganAt;
      if (pendingTab != null) await sleep(300); // a click that opens a tab: give it a moment to exist
    }
  } catch (err) {
    if (err instanceof StoppedError || signal.aborted) {
      if (tabClosed) {
        return finish(
          report(RUN_OUTCOME.failed, {
            reason: RUN_FAILURE_REASON.tabClosed,
            label: "The tab closed",
            detail: "The tab the run was working in was closed.",
            stage: RUN_STAGE.filling,
          }),
        );
      }
      return finish(
        report(RUN_OUTCOME.stopped, {
          reason: RUN_FAILURE_REASON.stoppedByUser,
          label: "Stopped by you",
          detail: "",
          stage: RUN_STAGE.filling,
        }),
        true,
      );
    }
    log.event("agent-error", {
      message: err instanceof Error ? err.message : String(err),
      code: err instanceof AgentApiError ? err.code : "",
    });
    return finish(report(RUN_OUTCOME.failed, failureFromError(err)), runSurvives(err));
  } finally {
    chrome.tabs.onCreated.removeListener(onCreated);
    frames.stop?.();
    if (sessionId && keepSession && args.keepRun) {
      // The agent keeps this run's memory; Continue takes it back up on the tab it stopped in.
      await args
        .keepRun(tabs, { sessionId, runId, tabId: current?.tabId ?? workTabId, stopBeforeSubmit })
        .catch(() => undefined);
    } else if (sessionId) {
      await endSession(args.agentUrl, sessionId);
    }
    await current?.close().catch(() => undefined);
  }
}

function must<T>(value: T | null): T {
  if (value == null) throw new Error("the run has no page yet");
  return value;
}
