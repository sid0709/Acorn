/**
 * An application Run driven by the agent server. The loop is the same at every step: look
 * at the page (a screenshot, and what the page says about the focused control), send it to
 * the server, perform the actions it sends back, and look again. The server remembers the
 * run and judges whether each action did what it meant; this side only sees and acts.
 */

import {
  AGENT_STATUS,
  type AgentAction,
  type AgentAsk,
  type AgentActionResult,
  type AgentStep,
  type AgentUsage,
} from "@acorn/shared/agent-contract";
import {
  RUN_FAILURE_REASON,
  RUN_OUTCOME,
  RUN_STAGE,
  type RunFailure,
  type RunReport,
} from "@acorn/shared/run-types";

import { RunLog, logUrl } from "../pipeline/run-log";

import { captureShot, type Shot } from "./capture";
import {
  AgentApiError,
  endSession,
  fetchResumeFile,
  isRetryable,
  sendStep,
  startSession,
} from "./client";
import { runActions, type ExecutorContext } from "./executor";
import { readFocus, readPageText } from "./page-info";
import {
  agentRunState,
  endProgress,
  failureFromError,
  failureFromStatus,
  runningProgress,
  AGENT_STARTING_MESSAGE,
} from "./progress";
import { openAgentTab, type AgentTab } from "./tab-session";
import { toBase64, type ResumeFile } from "./upload";

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
  /** The person's own OpenRouter key, when the extension holds one; the server has its own otherwise. */
  key?: string;
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
  const runId = crypto.randomUUID().slice(0, 8);
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
  let shot: Shot | null = null;
  let tabClosed = false;
  let lastUsage: AgentUsage | null = null;
  let stepNumber = 0;
  let pendingTab: number | null = null;
  const files = new Map<string, Promise<ResumeFile>>();

  const emit = (progress: PipelineProgress) => args.emit(tabs, progress);
  const runState = (control?: string, ask?: AgentAsk) =>
    agentRunState({ runId, startedAt, step: stepNumber, control, usage: lastUsage, ask });

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
  };

  /** Moves the run into the tab the page opened, so the application goes on where it went. */
  const followNewTab = async (id: number): Promise<string> => {
    const deadline = Date.now() + NEW_TAB_WAIT_MS;
    let tab = await chrome.tabs.get(id);
    while (!tab.url && Date.now() < deadline) {
      await sleep(200);
      tab = await chrome.tabs.get(id);
    }
    const previous = must(current);
    current = await openAgentTab(id, hooks, OVERLAY_LABEL);
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

  const finish = (report: RunReport): RunReport => {
    chrome.tabs.onCreated.removeListener(onCreated);
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
    emit(endProgress({ run: runState(), report, steps: stepNumber, startedAt, usage: lastUsage }));
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
    const tab = await chrome.tabs.get(args.tabId);
    log.event("agent-start", {
      tabId: args.tabId,
      url: logUrl(tab.url ?? ""),
      stopBeforeSubmit: args.stopBeforeSubmit,
    });
    current = await openAgentTab(args.tabId, hooks, OVERLAY_LABEL);
    const started = await startSession(
      args.agentUrl,
      { url: tab.url ?? "", title: tab.title ?? "", stopBeforeSubmit: args.stopBeforeSubmit },
      args.key,
    );
    sessionId = started.sessionId;
    log.event("agent-session", { resumes: started.resumes.length });

    let results: AgentActionResult[] = [];
    let carriedNotes: string[] = [];
    let answer: string | undefined;
    let sentText = "";
    for (;;) {
      checkStopped();
      if (pendingTab != null) {
        const id = pendingTab;
        pendingTab = null;
        carriedNotes.push(await followNewTab(id));
      }
      const here = must(current);
      await here.overlay.ensure();
      await here.overlay.hideForCapture(true);
      try {
        shot = await captureShot(here.cdp);
      } finally {
        await here.overlay.hideForCapture(false);
      }
      checkStopped();
      const [focus, info, text] = await Promise.all([
        readFocus(here.cdp),
        chrome.tabs.get(here.tabId),
        readPageText(here.cdp),
      ]);
      // The page's text goes once per change: the job description may sit above the form,
      // where a click on Apply has already scrolled past it.
      const fingerprint = text ? textFingerprint(text) : "";
      const pageText = fingerprint && fingerprint !== sentText ? text : undefined;
      if (pageText) sentText = fingerprint;
      const answered = answer;
      answer = undefined;
      const notes = [...carriedNotes, ...here.takeNotes()];
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
        ...(pageText ? { pageText } : {}),
        ...(answered ? { answer: answered } : {}),
      });
      checkStopped();
      stepNumber = step.number;
      lastUsage = step.usage;
      const actions = step.actions ?? [];
      log.step = step.number;
      log.event("agent-step", {
        number: step.number,
        status: step.status,
        message: step.message,
        actions: actions.map(describeAction),
        dropped: step.dropped,
        ms: Date.now() - askedAt,
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
        if (step.status === AGENT_STATUS.done) {
          return finish(
            report(args.stopBeforeSubmit ? RUN_OUTCOME.readyToSubmit : RUN_OUTCOME.completed),
          );
        }
        return finish(
          report(RUN_OUTCOME.failed, failureFromStatus(step.status, step.message, step.stop)),
        );
      }

      results = await runActions(executor, actions);
      for (const result of results) {
        if (!result.ok) log.event("agent-action:failed", { id: result.id, error: result.error });
      }
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
      );
    }
    log.event("agent-error", {
      message: err instanceof Error ? err.message : String(err),
      code: err instanceof AgentApiError ? err.code : "",
    });
    return finish(report(RUN_OUTCOME.failed, failureFromError(err)));
  } finally {
    chrome.tabs.onCreated.removeListener(onCreated);
    if (sessionId) await endSession(args.agentUrl, sessionId);
    await current?.close().catch(() => undefined);
  }
}

function must<T>(value: T | null): T {
  if (value == null) throw new Error("the run has no page yet");
  return value;
}
