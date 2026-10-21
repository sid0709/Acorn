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
  type AgentStarted,
  type AgentSurveyScreen,
  type AgentZoneShot,
  type AgentActionResult,
  type AgentMemory,
  type AgentStep,
  type AgentUsage,
} from "@acorn/shared/agent-contract";
import { VERIFICATION } from "@acorn/shared/run-types";
import {
  RUN_FAILURE_REASON,
  RUN_MAP_PHASE,
  RUN_OUTCOME,
  RUN_POINT_STATE,
  RUN_STAGE,
  type MailSearch,
  type RunFailure,
  type RunMapPhase,
  type RunPointState,
  type RunReport,
} from "@acorn/shared/run-types";

import { RunLog, logUrl } from "../pipeline/run-log";
import { whenTabNavigated } from "../tab-load";

import { captureShot, isTabHidden, type Shot } from "./capture";
import {
  AgentApiError,
  continueSession,
  fetchMemory,
  endSession,
  fetchResumeFile,
  isRetryable,
  locateTarget,
  preloadImage,
  sendShot,
  sendStep,
  startSession,
  vetTarget,
} from "./client";
import { buildCompletedRun, carriedLegs, jobPageOf, workedMs } from "./completed-run";
import {
  marksOfLook,
  noteLook,
  placeMarksFor,
  quietSettle,
  startControlWatch,
  syncControlLayout,
} from "./control-sync";
import { ControlWatch } from "./control-watch";
import {
  ACTION_PROGRESS,
  CHANGES_THE_PAGE,
  runActions,
  wasSkipped,
  type ActionProgress,
  type ExecutorContext,
} from "./executor";
import {
  createClickGuard,
  createFrameSweep,
  describeWindow,
  watchFrameEvents,
  windowClosedNote,
} from "./guard";
import { afterLook, foundIn, lookLogFields, missed, startMailSearch } from "./mail-search";
import {
  isEmailVerificationStop,
  noteForVerification,
  verificationKindFor,
  waitForMailVerification,
} from "./mail-verification";
import { readFocus, readOpenList, readPageText } from "./page-info";
import { PageMapKeeper, pageKey } from "./page-map";
import { pageState, type ScrollContext } from "./page-scroll";
import {
  agentRunState,
  endProgress,
  failureFromError,
  failureFromStatus,
  runningProgress,
  AGENT_EXPIRED_MESSAGE,
  AGENT_RESTORED_MESSAGE,
  AGENT_STARTING_MESSAGE,
} from "./progress";
import { RunShotsKeeper } from "./run-shots";
import { waitForScrollRest } from "./scroll-rest";
import { scrollToTop } from "./scroll-top";
import { AGENT_FAST_FILL, AGENT_SURVEY, AGENT_TRACE_IMAGES } from "./settings";
import { SurveyKeeper } from "./survey";
import { openAgentTab, type AgentTab } from "./tab-session";
import { Stopwatch, httpSummary, type HttpTiming } from "./timing";
import { recordAgentTrace, type AgentLook } from "./trace-log";
import { toBase64, type ResumeFile } from "./upload";

import type { Cdp } from "./cdp";
import type { KeptRun } from "./kept-run";
import type { PipelineProgress } from "@acorn/shared/pipeline-types";
import type { CompletedRunRecord } from "@acorn/shared/runs";

/** The most times one step is sent again when the model is busy or briefly down. */
export const STEP_RETRY_LIMIT = 3;
/** Waits between those retries, in order. */
export const STEP_RETRY_BACKOFF_MS = [2_000, 6_000, 15_000] as const;
/** How long a tab the page opened gets to show an address before the run goes on in it. */
export const NEW_TAB_WAIT_MS = 8_000;
/** How long the page an emailed link leads to gets to load before the run looks at it anyway. */
export const MAIL_LINK_LOAD_WAIT_MS = 15_000;
/** Told to the model when the tab a page opened was closed before the run could go into it. */
const NEW_TAB_GONE_NOTE =
  "The page opened a new tab, but it was closed. You are still in the same tab.";
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
  /** Use fast fill for this run; the default is AGENT_FAST_FILL (off). */
  fastFill?: boolean;
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
  /**
   * Keeps a Run that ended with the application sent, so the website can count it. It resolves once
   * the record is held, not when acorn-backend has it (completed-run-sync.ts). Without it the Run
   * is not counted.
   */
  recordCompleted?: (record: CompletedRunRecord) => Promise<void>;
}

/**
 * Keeps a stopped run for Continue, with what it knows beside the session: the agent's session
 * can be gone by the time Continue is pressed (the server restarted, or it expired).
 */
async function keepWithMemory(
  args: Pick<AgentRunArgs, "agentUrl" | "keepRun">,
  tabs: number[],
  run: KeptRun,
): Promise<void> {
  const memory = await fetchMemory(args.agentUrl, run.sessionId);
  await args.keepRun?.(tabs, memory ? { ...run, memory } : run).catch(() => undefined);
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
    case "snap":
      return "take a picture of the page";
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

/** Which optional ways of working a run uses: what the caller asked for, else the build's default. */
function runSwitches(args: AgentRunArgs): { surveyOn: boolean; fastFillOn: boolean } {
  const fastFillOn = args.fastFill ?? AGENT_FAST_FILL;
  return {
    // Fast fill plans a page from a survey of it, so a fast-fill run surveys.
    surveyOn: (args.survey ?? AGENT_SURVEY) || fastFillOn,
    fastFillOn,
  };
}

/**
 * What the agent says is settled goes to the next survey, which leaves those parts out, and to the
 * minimap in the sidebar, which paints them.
 */
function applySettled(step: AgentStep, surveys: SurveyKeeper, pages: PageMapKeeper): void {
  // The to-do list the sidebar shows is the model's reading of the pictures, sent when it changed.
  if (step.fields) pages.setFields(step.fields);
  if (!step.settled) return;
  surveys.setSettled(step.settled);
  pages.settle(step.settled);
}

/** A look at a page the run has not seen: nothing seen or settled on the last one holds, and its minimap goes. */
function forgetPage(
  newPage: boolean,
  from: string,
  to: string,
  surveys: SurveyKeeper,
  pages: PageMapKeeper,
  marks: ControlWatch,
  log: RunLog,
): void {
  if (!newPage) return;
  surveys.forget();
  pages.clear();
  marks.forget();
  log.event("agent-page", { from: logUrl(from), to: logUrl(to) });
}

/** What a point of the map becomes as its action goes: one that began is being acted on; the rest are as they say. */
const POINT_STATE_OF: Record<ActionProgress, RunPointState> = {
  [ACTION_PROGRESS.started]: RUN_POINT_STATE.current,
  [ACTION_PROGRESS.aimed]: RUN_POINT_STATE.current,
  [ACTION_PROGRESS.done]: RUN_POINT_STATE.done,
  [ACTION_PROGRESS.failed]: RUN_POINT_STATE.failed,
  [ACTION_PROGRESS.skipped]: RUN_POINT_STATE.skipped,
};

/**
 * The executor's word on each action, put on the map of the page and shown. An action aimed at a point has
 * the window's place read, so a point that followed its control is drawn where it went; nothing here may hold
 * the action up or fail it.
 */
function mapProgress(
  pageMap: PageMapKeeper,
  cdp: () => Cdp,
  show: () => void,
): NonNullable<ExecutorContext["progress"]> {
  return (action, state, at) => {
    if (state === ACTION_PROGRESS.aimed && at) {
      void pageState(cdp())
        .then((page) => {
          pageMap.acted(action.id, RUN_POINT_STATE.current, { x: at.x, y: page.y + at.y });
          show();
        })
        .catch(() => undefined);
      return;
    }
    pageMap.acted(action.id, POINT_STATE_OF[state]);
    show();
  };
}

/** What the run does after the agent's answer: carries out a plan, or waits on the person. */
function phaseAfter(step: AgentStep): RunMapPhase {
  return step.status === AGENT_STATUS.working ? RUN_MAP_PHASE.acting : RUN_MAP_PHASE.waiting;
}

/** The pictures of a look for the run's log: only a build that keeps pictures (AGENT_TRACE_IMAGES) logs them. */
function lookForLog(
  step: AgentStep,
  shot: Shot,
  survey: AgentSurveyScreen[] | null,
  zones: AgentZoneShot[],
): AgentLook | undefined {
  if (!AGENT_TRACE_IMAGES) return undefined;
  return {
    seq: step.trace?.seq ?? step.number,
    screenshot: shot.dataUrl,
    survey: survey ?? undefined,
    zones,
  };
}

/** Starts fetching each résumé a plan uploads, so the file is there by the time the upload is reached. */
function prefetchUploads(actions: AgentAction[], resume: ExecutorContext["resume"]): void {
  for (const action of actions) {
    if (action.kind === "upload" && action.resume)
      void resume(action.resume, action.fileName ?? action.resume).catch(() => undefined);
  }
}

/** A run surveys when it was set to, or the server says it does (fast fill, which the server may turn on for all runs). */
function followServerSurvey(surveyOn: boolean, started: AgentStarted): boolean {
  return surveyOn || started.survey === true;
}

export async function runAgent(args: AgentRunArgs): Promise<RunReport> {
  const { fastFillOn, ...switches } = runSwitches(args);
  let { surveyOn } = switches;
  // The server may turn fast fill on for every run: the run follows (when it starts a session).
  let serverFastFill = false;
  const fastFill = () => fastFillOn || serverFastFill;
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
  let restoredMemory: AgentMemory | undefined;
  /** Set when the run ends in a way Continue can take up again: the server keeps its memory. */
  let keepSession = false;
  // A continued run keeps what it was started with: the agent's prompt was fixed then.
  let stopBeforeSubmit = args.resume?.stopBeforeSubmit ?? args.stopBeforeSubmit;
  let shot: Shot | null = null;
  let tabClosed = false;
  let lastUsage: AgentUsage | null = null;
  let stepNumber = 0;
  // What the Run is counted with if it ends with the application sent: the page it began on (a
  // continued run keeps its first leg's), the time the legs before this one worked, and the cost
  // they ran up that this session's counters no longer hold (the agent forgot the run).
  const earlierLegs = carriedLegs(args.resume);
  let jobPage = earlierLegs.job;
  const carriedMs = earlierLegs.workMs;
  let carriedCostUsd = 0;
  /** The completed run's record being kept, waited for before the run is torn down. */
  const recordings: Promise<void>[] = [];
  /** How long the last step's actions took to run, for the log. */
  let lastActionsMs = 0;
  /** Where the run's time went, summed over its steps, for the `run:end` entry's `phases` (ms). */
  const spent = {
    look: 0,
    ask: 0,
    retryWait: 0,
    actions: 0,
    server: 0,
    network: 0,
    gmail: 0,
    start: 0,
    /** Waiting on the person to answer a question; not the run's own time. */
    person: 0,
  };
  /** The step request's timing, taken by the `agent-step` entry that follows it. */
  let stepHttp: HttpTiming | undefined;
  /** Every request to the agent server goes to the log with its timing, then adds to the totals. */
  const onHttp = (timing: HttpTiming) => {
    log.event("agent-http", { ...timing });
    spent.server += timing.serverMs ?? 0;
    spent.network += timing.networkMs ?? 0;
    if (timing.route.endsWith("/step")) stepHttp = timing;
  };
  /**
   * When the last actions that change a page began (a click, typing, a key, an upload): a site
   * sends its code or link in answer to one of these, so only mail from after it can be the site's.
   * A wait or a scroll does not count, or the email could arrive before the time it is looked for from.
   */
  let lastChangeAt = startedAt;
  /** Emails whose code or link was used: a site that asks again wants a newer one. */
  const usedMailIds: string[] = [];
  /** When the first search for the site's email began: a search for the same step again starts from it. */
  let mailSince: number | undefined;
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
  /** How long each résumé on offer is, so a slow line is given time to bring it. */
  const resumeSizes = new Map<string, number>();
  const vet = (target: Parameters<typeof vetTarget>[2]) =>
    vetTarget(args.agentUrl, must(sessionId), target, signal, onHttp);
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
  // The page the run is on, for the sidebar's minimap, and the line the card shows beside it.
  const pageMap = new PageMapKeeper();
  // The pictures the model was sent with each look, made small for the card's filmstrip beside the run.
  const runShots = new RunShotsKeeper(runId, (err) =>
    log.event("agent-shots:failed", { message: err instanceof Error ? err.message : String(err) }),
  );
  // What the survey has taken and what the model settled, which the run's scrolling keeps out of.
  const surveys = new SurveyKeeper();
  // The page's controls and where each sits, kept current in the page: a move of them places the blue stretches
  // and the points of a plan.
  const marks = new ControlWatch();
  const stopControlWatch = startControlWatch({
    tab: () => current,
    surveying: () => surveyOn,
    watch: marks,
    surveys,
    pages: pageMap,
    log,
    emit: () => {
      if (pageMap.current) emit(runningProgress(runState(), lastMessage));
    },
  });
  const scrolls: ScrollContext = {
    blue: (pageHeight) => surveys.blue(pageHeight),
    note: (move) => {
      log.event("agent-scroll", move);
      if (!move.refused) showMap(move.to);
    },
  };
  let lastMessage = AGENT_STARTING_MESSAGE;
  const runState = (control?: string, ask?: AgentAsk) =>
    agentRunState({
      runId,
      startedAt,
      step: stepNumber,
      control,
      usage: lastUsage,
      ask,
      mail: mailSearch,
      map: pageMap.current,
    });
  /** Shows the sidebar the run as it is now: the map of the page with it. */
  const showRun = () => emit(runningProgress(runState(), lastMessage));
  /** Tells the sidebar where the window is on the page, between steps (a survey, the zones and the actions move it). */
  const showMap = (viewTop: number) => {
    pageMap.moveTo(viewTop);
    showRun();
  };
  /** Puts the page on the map before the first look, so the card shows it at once. A page that cannot be read waits for the look. */
  const seedMap = async (tab: AgentTab) => {
    try {
      pageMap.start(await pageState(tab.cdp));
    } catch {
      return;
    }
    showRun();
  };

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
    const since = mailSince ?? lastChangeAt;
    const readStartedAt = Date.now();
    mailSearch = startMailSearch(kind, since);
    log.event("mail-verification:start", {
      kind,
      since,
      excluded: usedMailIds.length,
      startedAt: readStartedAt,
    });
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
      sinceMs: since,
      windowMs: MAIL_VERIFY_WINDOW_MS,
      exclude: usedMailIds,
      signal,
      onLook: (response) => {
        if (!mailSearch) return;
        mailSearch = afterLook(mailSearch, response.ok ? response.emails : undefined);
        log.event(
          "mail-verification:look",
          lookLogFields(mailSearch, response.model, response.opened),
        );
        showSearch();
      },
    });
    const readMs = Date.now() - readStartedAt;
    spent.gmail += readMs;
    if (outcome.ok) {
      mailSearch = foundIn(mailSearch, outcome.messageId, outcome.value);
      mailSince = since;
      if (outcome.messageId) usedMailIds.push(outcome.messageId);
      log.event("mail-verification:found", {
        kind: outcome.kind,
        messageId: outcome.messageId,
        ms: readMs,
      });
      showSearch();
      await continueSession(args.agentUrl, must(sessionId), onHttp);
      keepSession = false;
      if (outcome.kind === VERIFICATION.emailLink) {
        // The page the link leads to is waited for, so the next look is of it and not of the page it
        // left; the wait is set up first, so the old page's "complete" does not end it.
        const openedAt = Date.now();
        const loaded = whenTabNavigated(here.tabId, MAIL_LINK_LOAD_WAIT_MS);
        await chrome.tabs.update(here.tabId, { url: outcome.value });
        const stayed = await loaded;
        log.event("mail-verification:opened", { loaded: stayed, ms: Date.now() - openedAt });
      }
      pendingNotes.push(noteForVerification(outcome.kind, outcome.value));
      lastChangeAt = Date.now();
      void here.overlay.setLabel(OVERLAY_LABEL);
      return GMAIL_READ.found;
    }
    mailSearch = missed(mailSearch, outcome.reason === "error" ? outcome.detail : outcome.reason);
    log.event("mail-verification:miss", {
      reason: outcome.reason,
      detail: outcome.detail,
      ms: readMs,
    });
    return outcome.reason === "no_mailbox" ? GMAIL_READ.noMailbox : GMAIL_READ.missed;
  };

  // A tab a page of the run opened (a link, window.open) raises this; a tab the person opens
  // themselves (Cmd+T, +) does not, though Chrome gives it the same opener.
  const onCreated = (details: chrome.webNavigation.WebNavigationSourceCallbackDetails) => {
    if (details.sourceTabId === current?.tabId) pendingTab = details.tabId;
  };
  chrome.webNavigation.onCreatedNavigationTarget.addListener(onCreated);

  const hooks = {
    onStop: () => local.abort(),
    onTabClosed: () => {
      tabClosed = true;
      local.abort();
    },
  };

  // The photos of the zones of the plan being carried out, sent with the next look (fast fill).
  const zoneShots: AgentZoneShot[] = [];
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
        file = fetchResumeFile(
          args.agentUrl,
          must(sessionId),
          id,
          fileName,
          signal,
          toBase64,
          onHttp,
          resumeSizes.get(id),
        );
        files.set(id, file);
        file.then(
          (done) =>
            log.event("agent-resume", {
              resumeId: id,
              base64Chars: done.base64.length,
              encodeMs: done.encodeMs,
            }),
          () => files.delete(id),
        );
      }
      return file;
    },
    sleep,
    checkStopped,
    guard: clickGuard,
    afterClick: () => frames.sweep(),
    scroll: scrolls,
    marks: placeMarksFor({ tab: () => must(current), watch: marks, log }),
    // A fast-fill run waits for the page to go quiet after an action, not the fixed time a slow page needs.
    settle: quietSettle(() => must(current), sleep, fastFill),
    progress: mapProgress(
      pageMap,
      () => must(current).cdp,
      () => showRun(),
    ),
    snap: async (action) => {
      const here = must(current);
      await here.overlay.hideForCapture(true);
      try {
        const photo = await captureShot(here.cdp);
        // What the page says of the list the click opened: the focused control, and the options it names.
        const [focus, list] = await Promise.all([
          readFocus(here.cdp),
          readOpenList(here.cdp, photo.scale),
        ]);
        // A picture that did not get through is not an error: the dropdown goes back to being set one at a time.
        await sendShot(
          args.agentUrl,
          must(sessionId),
          {
            kind: "snap",
            id: action.id,
            screenshot: photo.dataUrl,
            scrollY: photo.viewport.scrollY,
            focus,
            list,
          },
          signal,
          onHttp,
        ).catch((err: unknown) => {
          if (signal.aborted) throw err;
        });
      } finally {
        await here.overlay.hideForCapture(false);
      }
    },
    locate: async (action) => {
      const here = must(current);
      await here.overlay.hideForCapture(true);
      try {
        const photo = await captureShot(here.cdp);
        const found = await locateTarget(
          args.agentUrl,
          must(sessionId),
          { actionId: action.id, screenshot: photo.dataUrl, scrollY: photo.viewport.scrollY },
          signal,
          onHttp,
        );
        log.event("agent-locate", {
          id: action.id,
          found: found.found,
          score: found.score,
          reason: found.reason,
        });
        return found.found && found.x != null && found.y != null
          ? { x: found.x, y: found.y }
          : null;
      } catch (err) {
        if (signal.aborted) throw err;
        return null;
      } finally {
        await here.overlay.hideForCapture(false);
      }
    },
    zoneDone: async (zone) => {
      const here = must(current);
      await here.overlay.hideForCapture(true);
      try {
        const photo = await captureShot(here.cdp);
        zoneShots.push({ zone, screenshot: photo.dataUrl, scrollY: photo.viewport.scrollY });
        // The agent reviews the zone while the next one is carried out, behind whatever an action waits
        // on; the look after the plan names the photo again (as a reference once it got through, as
        // bytes for one that did not).
        void sendShot(
          args.agentUrl,
          must(sessionId),
          { kind: "zone", zone, screenshot: photo.dataUrl, scrollY: photo.viewport.scrollY },
          signal,
          onHttp,
          "background",
        ).catch(() => undefined);
        showMap(photo.viewport.scrollY / photo.scale);
      } finally {
        await here.overlay.hideForCapture(false);
      }
    },
  };

  /** Moves the run into the tab the page opened, so the application goes on where it went. */
  const followNewTab = async (id: number): Promise<string> => {
    const deadline = Date.now() + NEW_TAB_WAIT_MS;
    try {
      let tab = await chrome.tabs.get(id);
      while (!tab.url && Date.now() < deadline) {
        await sleep(200);
        tab = await chrome.tabs.get(id);
      }
    } catch {
      // Closed before the run got there: the run stays where it was.
      log.event("agent-new-tab:gone", { tabId: id });
      return NEW_TAB_GONE_NOTE;
    }
    // A window a click opened is judged before the run goes into it: an online file source or a
    // sign-in to one is closed, and the run stays where it was.
    try {
      const verdict = await vet(await describeWindow(id, pageUrl));
      if (verdict.blocked) {
        await chrome.tabs.remove(id).catch(() => undefined);
        log.event("agent-guard", { closed: "window" });
        return windowClosedNote(verdict.cause);
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
        return await sendStep(args.agentUrl, must(sessionId), observation, signal, onHttp);
      } catch (err) {
        checkStopped();
        if (!isRetryable(err) || attempt >= STEP_RETRY_LIMIT) throw err;
        const backoff = args.retryBackoffMs ?? STEP_RETRY_BACKOFF_MS;
        const waitMs = backoff[Math.min(attempt, backoff.length - 1)];
        log.event("agent-step:retry", {
          attempt: attempt + 1,
          code: err instanceof AgentApiError ? err.code : "",
          startedAt: Date.now(),
          waitMs,
        });
        await sleep(waitMs);
        spent.retryWait += waitMs;
      }
    }
  };

  /** How long the run has worked over its legs, without the time it waited on the person's answers (ms). */
  const workedSoFar = (endedAt = Date.now()) =>
    workedMs({ carriedMs, startedAt, endedAt, waitedOnPersonMs: spent.person });
  /** What the models have cost over the run's legs (dollars). */
  const costSoFar = () => carriedCostUsd + (lastUsage?.cost ?? 0);

  const finish = (report: RunReport, resumable = false): RunReport => {
    chrome.webNavigation.onCreatedNavigationTarget.removeListener(onCreated);
    pageMap.phase(RUN_MAP_PHASE.ended);
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
      phases: { ...spent, total: Date.now() - startedAt },
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
    if (report.outcome === RUN_OUTCOME.completed && args.recordCompleted) {
      // The application went in: count it. The card has its celebration already; this only keeps
      // the record (the link, the time, the cost) until acorn-backend has it.
      const endedAt = Date.now();
      const record = buildCompletedRun({
        runId,
        job: jobPage,
        endedAt,
        workMs: workedSoFar(endedAt),
        costUsd: costSoFar(),
        steps: stepNumber,
        usage: lastUsage,
      });
      log.event("run:recorded", {
        recordId: record.recordId,
        durationMs: record.durationMs,
        costNanos: record.costNanos,
      });
      recordings.push(
        args.recordCompleted(record).catch((err) =>
          log.event("run:record:failed", {
            message: err instanceof Error ? err.message : String(err),
          }),
        ),
      );
    }
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
    jobPage = jobPageOf(jobPage, tab);
    log.event("agent-start", {
      tabId: workTabId,
      url: logUrl(tab.url ?? ""),
      stopBeforeSubmit,
      continued: Boolean(args.resume),
    });
    current = await openAgentTab(workTabId, hooks, OVERLAY_LABEL);
    watchFrames(current);
    await seedMap(current);
    if (args.resume) {
      // Held from now on, so a Continue that fails for want of the network can be tried again.
      sessionId = args.resume.sessionId;
      try {
        const continued = await continueSession(args.agentUrl, sessionId, onHttp);
        stepNumber = continued.number;
        lastUsage = continued.usage;
        log.step = continued.number;
        log.event("agent-continue", { step: continued.number, calls: continued.usage.calls });
      } catch (err) {
        // A run the agent forgot (it expired, or the server restarted) cannot be continued: start over.
        if (!(err instanceof AgentApiError && err.code === AGENT_ERROR_CODE.noSession)) throw err;
        log.event("agent-continue:lost", {
          sessionId: args.resume.sessionId,
          restored: Boolean(args.resume.memory),
        });
        sessionId = null;
        restoredMemory = args.resume.memory;
        carriedCostUsd = earlierLegs.costUsd;
        // With the run's memory kept, the new session goes on from it as it was started; without it
        // the run starts over, as the person's settings are now.
        if (!restoredMemory) stopBeforeSubmit = args.stopBeforeSubmit;
        emit(
          runningProgress(
            runState(),
            restoredMemory ? AGENT_RESTORED_MESSAGE : AGENT_EXPIRED_MESSAGE,
          ),
        );
      }
    }
    if (!sessionId) {
      const sessionStartedAt = Date.now();
      const started = await startSession(
        args.agentUrl,
        {
          url: tab.url ?? "",
          title: tab.title ?? "",
          stopBeforeSubmit,
          trace: true,
          traceImages: AGENT_TRACE_IMAGES,
          survey: surveyOn,
          fastFill: fastFillOn,
          ...(restoredMemory ? { memory: restoredMemory } : {}),
        },
        args.key,
        args.accessToken,
        onHttp,
      );
      sessionId = started.sessionId;
      // The server may turn fast fill on for every run, and a fast-fill run surveys.
      surveyOn = followServerSurvey(surveyOn, started);
      serverFastFill = started.fastFill === true;
      spent.start = Date.now() - sessionStartedAt;
      log.event("agent-session", { resumes: started.resumes.length, ms: spent.start });
      started.resumes.forEach((resume) => resumeSizes.set(resume.id, resume.size));
      recordAgentTrace(log, started.trace);
    }

    let results: AgentActionResult[] = [];
    let carriedNotes: string[] = [];
    let answer: string | undefined;
    let sentText = "";
    // With surveys on (AGENT_SURVEY), the first look of a page is a survey of the whole of it, so
    // the model can plan the form at once; so is the look after the model asks for one.
    let surveyNext = surveyOn;
    // What the last survey saw, so the next one takes again only what changed; and whether the batch
    // just carried out leaves it good for the parts the batch did not touch (survey.ts).
    let lastLook = "";
    for (;;) {
      checkStopped();
      // The look: everything from here to the request, timed by part.
      const look = new Stopwatch();
      if (pendingTab != null) {
        const id = pendingTab;
        pendingTab = null;
        carriedNotes.push(await look.time("newTab", () => followNewTab(id)));
      }
      const here = must(current);
      // A frame an online file source drew over the page is gone before the screenshot is taken.
      await look.time("sweep", () => frames.sweep());
      await look.time("overlay", () => here.overlay.ensure());
      const info = await look.time("tabInfo", () => chrome.tabs.get(here.tabId));
      const lookKey = pageKey(info.url);
      const cameFrom = lastLook;
      const newPage = lookKey !== lastLook;
      const surveying = surveyOn && (surveyNext || newPage);
      surveyNext = false;
      lastLook = lookKey;
      // A page is first looked at from its top: a run that starts, or a click that opens another page,
      // must not begin in the middle of a form whose first questions lie above the screen.
      forgetPage(newPage, cameFrom, lookKey, surveys, pageMap, marks, log);
      if (newPage) await look.time("scrollTop", () => scrollToTop(here.cdp, sleep, scrolls));
      // A scroll still running (a key, a click, a list scrolling itself into view) is waited out.
      await look.time("scrollRest", () => waitForScrollRest(here.cdp, sleep));
      await syncControlLayout(surveyOn, here.cdp, marks, surveys);
      let survey: AgentSurveyScreen[] | null = null;
      const captureStartedAt = Date.now();
      await look.time("hideOverlay", () => here.overlay.hideForCapture(true));
      try {
        shot = await look.time("shot", () => captureShot(here.cdp));
        surveys.seen(shot);
        pageMap.look(shot, surveys.settledOn(shot));
        showRun();
        if (surveying) {
          const first = shot;
          survey = await look
            .time("survey", () =>
              surveys.take(
                {
                  cdp: here.cdp,
                  sleep,
                  checkStopped,
                  onMove: showMap,
                  scroll: scrolls,
                  // A screen's edge cuts no control with its field: the plan's points are aimed at whole controls.
                  controls: () => marks.marks.map((mark) => mark.box ?? mark),
                  // Each screen goes to the agent as it is taken, so the look that follows refers to it.
                  preload: (dataUrl) =>
                    preloadImage(args.agentUrl, must(sessionId), dataUrl, signal, onHttp),
                },
                first,
                zoneShots,
              ),
            )
            .catch((err: unknown) => {
              if (signal.aborted) throw err;
              return null; // a page that cannot be surveyed is looked at one screen at a time
            });
        }
      } finally {
        await look.time("showOverlay", () => here.overlay.hideForCapture(false));
      }
      const captureMs = Date.now() - captureStartedAt;
      const tabHidden = await look.time("tabHidden", () => isTabHidden(here.cdp));
      checkStopped();
      if (survey) {
        log.event("agent-survey", {
          screens: survey.length,
          reused: surveys.reused,
          settled: surveys.left,
        });
      }
      pageMap.survey(survey, surveys.fresh, shot.viewport.height);
      void runShots.publish(tabs, shot, survey, surveys.fresh, [...zoneShots]);
      pageMap.phase(RUN_MAP_PHASE.thinking);
      showRun();
      const [focus, text, list] = await look.time("pageRead", () =>
        Promise.all([
          readFocus(here.cdp),
          readPageText(here.cdp, here.tabId),
          readOpenList(here.cdp, shot?.scale ?? 1),
        ]),
      );
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
      spent.look += askedAt - look.startedAt;
      stepHttp = undefined;
      // The list this look tells the agent of: the form moves from here on are measured from it. The look's
      // name goes with it, the same on a retry, so the agent places the move once.
      const sentMarks = noteLook(marks, survey);
      const lookId = crypto.randomUUID().slice(0, 8);
      const step = await askWithRetry({
        look: lookId,
        screenshot: shot.dataUrl,
        url: info.url ?? "",
        title: info.title ?? "",
        viewport: shot.viewport,
        focus,
        notes,
        results,
        list,
        ...(survey ? { survey } : {}),
        ...(zoneShots.length > 0 ? { zoneShots: [...zoneShots] } : {}),
        ...(pageText ? { pageText } : {}),
        ...(answered ? { answer: answered } : {}),
        ...marksOfLook(marks, sentMarks, shot.scale),
      });
      checkStopped();
      const askMs = Date.now() - askedAt;
      spent.ask += askMs;
      stepNumber = step.number;
      lastUsage = step.usage;
      applySettled(step, surveys, pageMap);
      marks.commit(sentMarks);
      surveys.noteLayout(marks.moves());
      pageMap.setMoves(marks.moves());
      const actions = step.actions ?? [];
      // A résumé the plan uploads is fetched now, while the actions before the upload run.
      prefetchUploads(actions, executor.resume);
      pageMap.plan(actions, shot);
      pageMap.phase(phaseAfter(step));
      if (step.survey) surveyNext = true;
      log.step = step.number;
      // The zone photos go to the log with this look's pictures, when pictures are kept; either way the
      // next look starts without them.
      recordAgentTrace(log, step.trace, lookForLog(step, shot, survey, zoneShots.splice(0)));
      log.event("agent-step", {
        number: step.number,
        status: step.status,
        message: step.message,
        actions: actions.map(describeAction),
        dropped: step.dropped,
        ms: askMs,
        // When each part of the step began (unix ms), so a gap between them shows as a gap.
        lookStartedAt: look.startedAt,
        askStartedAt: askedAt,
        askEndedAt: askedAt + askMs,
        lookMs: askedAt - look.startedAt,
        // The look's parts (capture, page reads, scroll waits), and the request's: the server's
        // own time against the network's (send, wire, read), with the bytes each way.
        lookLaps: look.laps,
        ...httpSummary(stepHttp),
        captureMs,
        // Where a slow run lost its time: capturing, the actions of the step before, and whether the tab was not shown.
        actionsMs: lastActionsMs,
        hidden: tabHidden,
        calls: step.usage.calls,
        costUsd: step.usage.cost,
        url: logUrl(info.url ?? ""),
      });
      lastMessage = step.message || "Working…";
      emit(
        runningProgress(runState(actions[0] ? describeAction(actions[0]) : undefined), lastMessage),
      );
      void here.overlay.setLabel(step.message || OVERLAY_LABEL);

      if (step.status === AGENT_STATUS.needPerson && isEmailVerificationStop(step.stop?.reason)) {
        const gmail = await readGmail(step, info, text, here);
        if (gmail === GMAIL_READ.found) {
          // A link that was opened led to another page, maybe at the same address: the next look
          // starts it afresh, from its top, with nothing of the page it left kept as settled.
          if (verificationKindFor(step.stop) === VERIFICATION.emailLink) lastLook = "";
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
        const askedPersonAt = Date.now();
        answer = await args.waitForAnswer(signal);
        checkStopped();
        spent.person += Date.now() - askedPersonAt;
        log.event("agent-answer", {
          id: ask.id,
          answer,
          startedAt: askedPersonAt,
          ms: Date.now() - askedPersonAt,
        });
        results = [];
        void here.overlay.setLabel(OVERLAY_LABEL);
        continue;
      }

      if (step.status !== AGENT_STATUS.working) {
        log.decision(
          `agent:${step.status}`,
          step.message,
          { step: step.number, readyToSubmit: step.readyToSubmit === true },
          step.status === AGENT_STATUS.done ? undefined : "warn",
        );
        // A run that ends may first scroll what the person must act on into view.
        if (actions.length > 0) await runActions(executor, actions);
        if (step.status === AGENT_STATUS.done) {
          // The agent says when a done stopped before sending (the server may hold every run before the
          // control that sends, whatever this run asked for); an older agent leaves it to what was asked.
          const ready = step.readyToSubmit === true || stopBeforeSubmit;
          return finish(report(ready ? RUN_OUTCOME.readyToSubmit : RUN_OUTCOME.completed));
        }
        return finish(
          report(RUN_OUTCOME.failed, failureFromStatus(step.status, step.message, step.stop)),
          true,
        );
      }

      const actionsBeganAt = Date.now();
      const batch = new Stopwatch();
      results = await runActions(executor, actions, batch);
      surveys.noteBatch(actions, results);
      lastActionsMs = Date.now() - actionsBeganAt;
      spent.actions += lastActionsMs;
      // What each action took and where, so a slow step is read from the log, not guessed.
      log.event("agent-actions", {
        step: step.number,
        startedAt: actionsBeganAt,
        ms: lastActionsMs,
        batchLaps: batch.laps,
        actions: results.map((result) => ({
          id: result.id,
          ok: result.ok,
          startedAt: result.startedAt,
          ms: result.ms,
          laps: result.laps,
        })),
      });
      // One entry for the action that failed; the ones after it were not run, and are one line, not one each.
      for (const result of results) {
        if (!result.ok && !wasSkipped(result)) {
          log.event("agent-action:failed", { id: result.id, error: result.error });
        }
      }
      const skipped = results.filter(wasSkipped);
      if (skipped.length > 0) {
        log.event("agent-actions:skipped", {
          count: skipped.length,
          ids: skipped.map((result) => result.id),
        });
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
    stopControlWatch();
    chrome.webNavigation.onCreatedNavigationTarget.removeListener(onCreated);
    frames.stop?.();
    await Promise.all(recordings);
    if (sessionId && keepSession && args.keepRun) {
      // The agent keeps this run's memory; Continue takes it back up on the tab it stopped in.
      await keepWithMemory(args, tabs, {
        sessionId,
        runId,
        tabId: current?.tabId ?? workTabId,
        stopBeforeSubmit,
        job: jobPage,
        workMs: workedSoFar(),
        costUsd: costSoFar(),
      });
    } else if (sessionId) {
      await endSession(args.agentUrl, sessionId, onHttp);
    }
    await current?.close().catch(() => undefined);
  }
}

function must<T>(value: T | null): T {
  if (value == null) throw new Error("the run has no page yet");
  return value;
}
