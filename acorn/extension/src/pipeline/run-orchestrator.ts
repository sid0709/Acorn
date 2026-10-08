import { formatUsd } from "@acorn/shared/ai-usage";
import {
  FILL_MODE,
  countFlaggedSince,
  countNotedSince,
  countRequiredEmpty,
  type FieldIssueScan,
  type FillMode,
} from "@acorn/shared/field-issues";
import { PhaseClock } from "@acorn/shared/phase-clock";
import { appendPlanTurn, type PlanTurn } from "@acorn/shared/plan-history";
import {
  ACCOUNT_MODE,
  CONTROL_ROLE,
  MAIL_VERIFICATION_STATUS,
  PAGE_KIND,
  RUN_FAILURE_REASON,
  RUN_OUTCOME,
  RUN_STAGE,
  VERIFICATION,
  type AccountAttempt,
  type AccountMode,
  type MailRow,
  type PageKind,
  type RunFailure,
  type RunProgress,
  type RunReport,
  type RunStage,
  type Verification,
} from "@acorn/shared/run-types";

import { getAcornSocket } from "../acorn-socket";
import { markTabUsage, usageSince, type UsageMark } from "../background/tab-usage-store";
import { rekeyCustomTab } from "../tab-custom-session";
import { getTabJob, rekeyTabJob } from "../tab-job-session";

import { nextAccountGoal } from "./account-goal";
import {
  requestDiagnose,
  requestMailVerification,
  requestReadPage,
  READ_INTENT,
  type ReadIntent,
} from "./api/run";
import { appliedTo, rememberApplied } from "./applied-postings";
import { repairDriftInTab } from "./drift";
import { fetchDomFromTab } from "./fetch-dom";
import { RESUME_NOT_CHOSEN, type ResumeGate } from "./resume-gate";
import {
  clearRunCheckpoint,
  restoredRun,
  saveRunCheckpoint,
  type RunCheckpoint,
} from "./run-checkpoint";
import {
  clickControl,
  isOpenableLink,
  openLinkInTab,
  probePage,
  sleep,
  waitForPageSettled,
  waitForPerson,
  settleAfterClick,
  watchOpenedTabs,
  type SettleHow,
} from "./run-click";
import { failureEvidence } from "./run-evidence";
import {
  RUN_ACCOUNT_MESSAGES_MAX,
  RUN_MAIL_POLL_MS,
  RUN_MAIL_WAIT_MAX_MS,
  RUN_MAX_ACCOUNT_ATTEMPTS,
  RUN_MAX_AI_CALLS,
  RUN_MAX_MAIL_VERIFICATIONS,
  RUN_UNCLEAR_REREADS,
  RUN_UNCLEAR_WAIT_MS,
  RUN_MAX_BLOCKED_PASSES,
  RUN_MAX_FILLS_PER_PAGE,
  RUN_MAX_CLICK_RETRIES,
  RUN_MAX_NO_EFFECT,
  RUN_MAX_PAGES,
  RUN_MAX_REFILLS_PER_PAGE,
  RUN_MAX_STEPS,
} from "./run-limits";
import { logUrl, RunLog } from "./run-log";
import { snapshotPage, type PageSnapshot } from "./run-page";
import { NO_RESUME_FILE, runFabPipeline } from "./run-pipeline";
import { ensureRecommendedResume } from "./run-resume";
import { isNewStep } from "./run-step";

import type { PipelineProgress } from "@acorn/shared/pipeline-types";
import type { RunStepRecord } from "@acorn/shared/plan-runner/types";

/** Shown when the decision model cannot name a reason. */
const UNKNOWN_FAILURE_LABEL = "The run could not finish";
const UNKNOWN_FAILURE_REASON = "other";

const STAGE_MESSAGE: Record<RunStage, string> = {
  [RUN_STAGE.reading]: "Reading the page…",
  [RUN_STAGE.recommending]: "Recommending a résumé…",
  [RUN_STAGE.applying]: "Opening the application…",
  [RUN_STAGE.filling]: "Filling the page…",
  [RUN_STAGE.advancing]: "Moving to the next step…",
  [RUN_STAGE.refilling]: "Fixing the fields the page flagged…",
  [RUN_STAGE.verifying]: "Reading your email for the verification…",
  [RUN_STAGE.account]: "Working through the site's account step…",
  [RUN_STAGE.diagnosing]: "Working out what went wrong…",
};

/** What the run says while it sends an account step of each kind. */
const ACCOUNT_MESSAGE: Record<AccountMode, string> = {
  [ACCOUNT_MODE.none]: "Next step",
  [ACCOUNT_MODE.signIn]: "Signing in",
  [ACCOUNT_MODE.createAccount]: "Creating an account",
  [ACCOUNT_MODE.resetPassword]: "Resetting the password",
  [ACCOUNT_MODE.choose]: "Choosing how to go on",
};

/** Page kinds that may only be a page still loading; looked at again before the run stops. */
const UNCLEAR_KINDS = new Set<PageKind>([PAGE_KIND.blocked, PAGE_KIND.other]);

/** Verifications the applicant's connected Gmail can answer. */
const MAIL_VERIFICATIONS = new Set<Verification>([VERIFICATION.emailCode, VERIFICATION.emailLink]);

export interface RunOrchestratorArgs {
  tabId: number;
  preferredFrameId?: number | null;
  apiUrl: string;
  /** Progress goes to every tab the run has used, so the sidebar follows an Apply that opens a tab. */
  emit: (tabIds: number[], progress: PipelineProgress) => void;
  /** Called when the run moves to another tab, so that tab cannot start a second run. */
  claimTab: (tabId: number) => void;
  /** Aborts when the person presses Stop: the run stops at once and touches the page no more. */
  signal?: AbortSignal;
  /** Stop before Submit: on the last step, stop at the control that sends the application. */
  stopBeforeSubmit?: boolean;
  /** Continue: carry on from where an earlier run on this tab stopped. */
  resumeFrom?: RunCheckpoint | null;
}

/** Where the run is on one page. */
interface PageState {
  /** The page as the run last saw it; its own edits update this, they never make a new step. */
  signature: string;
  url: string;
  filled: boolean;
  /** Clicks of a Next / Submit / Apply control on this page. */
  clicks: number;
  refills: number;
  noEffect: number;
  /** The fields as they stood right before the last forward click. */
  scanBeforeClick: FieldIssueScan | null;
  /**
   * The fields before the fill: text that shows up beside a field after it is the
   * page answering the fill. Moves forward when Refill finds nothing in it to fix.
   */
  scanBeforeFill: FieldIssueScan | null;
  /** Plans run on this page, oldest first; a Refill continues from them. */
  turns: PlanTurn[];
  /** When this page's fill began; drift repair replays only answers given since. */
  fillStartedAt: number;
  /** The last click never landed; the next look is a fresh read, not a click's outcome. */
  retryClick: boolean;
  /** Passes over what the page still needed while it held its forward control disabled. */
  blockedPasses: number;
  /** Fills of this step of any kind; capped by RUN_MAX_FILLS_PER_PAGE. */
  fills: number;
  /** A code from the applicant's mail was entered here; the page is not searched for again. */
  verified: boolean;
}

/** A click either landed and settled, or never reached its control. */
type ClickOutcome =
  | { settled: Awaited<ReturnType<typeof settleAfterClick>>; missed?: undefined }
  | { missed: string; disabled: boolean; settled?: undefined };

class RunStop extends Error {
  constructor(
    readonly stage: RunStage,
    readonly snapshot: PageSnapshot | null,
    readonly notes: string[],
    readonly steps?: RunStepRecord[],
    /** A reason the run already knows; the decision model is not asked. */
    readonly known?: Omit<RunFailure, "stage">,
  ) {
    super(notes[0] ?? UNKNOWN_FAILURE_LABEL);
  }
}

/** Fields a stuck page still shows blank or off, as evidence lines (labels only, never values). */
async function unansweredNotes(tabId: number, frameId: number | null): Promise<string[]> {
  const dom = await fetchDomFromTab(tabId, frameId, {
    formFields: true,
    pendingFields: true,
    blockedFields: true,
  }).catch(() => null);
  return (dom?.formFields ?? []).map((field) =>
    field.kind === "toggle"
      ? `Box "${field.label}" is still unchecked`
      : `Field "${field.label}" is still unanswered`,
  );
}

/** The run waits while the page needs a step only the applicant can do. */
const WAITING_FOR_PERSON =
  "Waiting for you to finish this step on the page; Acorn goes on once it moves";
/** The run stopped waiting for the applicant to do a step only they can. */
const WAITED_FOR_PERSON = "The page is waiting for a step only you can do";

/** Why a run stopped on its own budget; shown as the stop's label. */
const BUDGET_SPENT = "The run reached its limit on AI work";

/** The emailed code or link could not be found. */
const VERIFICATION_NOT_FOUND = "The code or link the site emailed was not found in your Gmail";
/** The site kept refusing the account step. */
const ACCOUNT_REJECTED = "The site kept rejecting the sign-in or sign-up";
/** The posting was applied to already. */
const ALREADY_APPLIED = "You already applied to this job";
/** Every account step was tried on the site and refused. */
const ACCOUNT_EXHAUSTED = "Tried creating an account, signing in, and resetting the password";
/** The person pressed Stop. */
const STOPPED_BY_YOU = "You stopped the run";
const STOPPED_FAILURE: Omit<RunFailure, "stage"> = {
  reason: RUN_FAILURE_REASON.stoppedByUser,
  label: STOPPED_BY_YOU,
  detail: "",
};
/** The site needs an account and the profile has no password to give it. */
const NO_ACCOUNT_PASSWORD =
  "This site needs an account: add a default account password to your Acorn profile";

/** Lines the page shows now that it did not show before: what it said in answer. */
function newLines(before: string, after: string): string[] {
  const seen = new Set(before.split("\n").map((line) => line.trim()));
  return after
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !seen.has(line));
}

/** The site part of an address, so account history stays with the site it belongs to. */
function siteOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** The run stops before touching the page: no résumé to apply with. */
function noResumeStop(stage: RunStage, snapshot: PageSnapshot | null, detail: string): RunStop {
  return new RunStop(stage, snapshot, [detail], undefined, {
    reason: RUN_FAILURE_REASON.resumeNotChosen,
    label: RESUME_NOT_CHOSEN,
    detail,
  });
}

/**
 * What a run leaves behind when it ends: a finished application is remembered so
 * it is never sent twice; a run stopped partway keeps a checkpoint so Continue
 * carries on from there. True when Continue is offered.
 */
async function keepRunEnd(
  tabId: number,
  outcome: RunReport["outcome"],
  title: string,
  checkpoint: RunCheckpoint,
): Promise<boolean> {
  if (outcome === RUN_OUTCOME.completed && checkpoint.startUrl) {
    await rememberApplied([checkpoint.startUrl], title).catch(() => undefined);
  }
  const canContinue = outcome === RUN_OUTCOME.failed || outcome === RUN_OUTCOME.stopped;
  if (canContinue) await saveRunCheckpoint(tabId, checkpoint).catch(() => undefined);
  else await clearRunCheckpoint(tabId).catch(() => undefined);
  return canContinue;
}

function newRunId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Run: read the page, recommend a résumé, open the application, then fill each page
 * and move on (Next or Submit) until the application is complete. A page that
 * rejects the answers is refilled up to a limit. Every "what is this page" and
 * "what do I click" is a decision by the model (Jev), never a match on button text.
 */
// eslint-disable-next-line complexity -- single state machine for the full apply run
export async function runOrchestrator(args: RunOrchestratorArgs): Promise<RunReport> {
  const { apiUrl } = args;
  let tabId = args.tabId;
  const tabs = [tabId];
  const runId = newRunId();
  /** Where each tab's usage stood when the run reached it; the run's cost is everything since. */
  const usageMarks: Promise<UsageMark | null>[] = [markTabUsage(tabId).catch(() => null)];
  const log = new RunLog(runId, tabId);
  const startedAt = Date.now();

  let stage: RunStage = RUN_STAGE.reading;
  let kind: PageKind | undefined;
  let control: string | undefined;
  // Continue starts from where the last run on this tab stopped; a new run from nothing.
  const restored = restoredRun(args.resumeFrom);
  let pageCount = restored.pages;
  /** The page the run started on: the posting it applies to. */
  let startUrl = restored.startUrl;
  /** On Continue, the page already filled before the stop is not filled again. */
  let resumeFilledSignature = restored.filledSignature;
  let refillsTotal = 0;
  let refillsOnPage = 0;
  let current: PageState | null = null;
  let snapshot: PageSnapshot | null = null;
  let resumeChecked = false;
  /** Clicks in a row that never reached their control. */
  let clickFailures = 0;
  /** A résumé recommend in flight; it must settle before any click or fill. */
  let recommending: Promise<ResumeGate> | null = null;
  /** Account steps sent so far, with the site each was sent on. */
  const accountHistory: { site: string; attempt: AccountAttempt }[] = restored.accountHistory;
  /** The account step the last click sent; its outcome is the page that follows. */
  let accountSent: {
    site: string;
    mode: AccountMode;
    textBefore: string;
    messagesBefore: string[];
  } | null = null;
  /** A reset request was just sent: its answer is an email, read before anything else. */
  let mailExpected = false;
  /** Sites where a reset link from the mail was opened: their next reset form sets the password. */
  const resetLinkSites = new Set<string>(restored.resetLinkSites);
  /** The account form the current page shows, from its last read; null on a new page. */
  let pageAccountMode: AccountMode | null = null;
  /** This site's account attempts, oldest first. */
  const siteAttempts = (url: string) =>
    accountHistory.filter((entry) => entry.site === siteOf(url)).map((entry) => entry.attempt);
  /** The account step the run tries next on this page's site (see account-goal). */
  const accountGoal = (url: string) => nextAccountGoal(siteAttempts(url), pageAccountMode);
  /** When the run last clicked: an email the site sent for this step arrived after it. */
  let lastClickAt = 0;
  /** Codes and links taken from the applicant's mail so far. */
  let mailVerifications = restored.mailVerifications;
  /** The newest emails the current mail look hands to Jev, for the sidebar. */
  let mailRows: MailRow[] | undefined;
  const clock = new PhaseClock();

  // Stop: every long wait races this, so the run ends the moment the person presses
  // Stop; every page action checks it first, so nothing more touches the page.
  const signal = args.signal;
  const stoppedStop = () =>
    new RunStop(stage, snapshot, [STOPPED_BY_YOU], undefined, STOPPED_FAILURE);
  const stopped = new Promise<never>((_, reject) => {
    const fail = () => reject(stoppedStop());
    if (signal?.aborted) fail();
    else signal?.addEventListener("abort", fail, { once: true });
  });
  stopped.catch(() => undefined);
  const until = <T>(work: Promise<T>): Promise<T> => Promise.race([work, stopped]);
  const checkStop = () => {
    if (signal?.aborted) throw stoppedStop();
  };

  const snap = (opts: Parameters<typeof snapshotPage>[1]) =>
    until(clock.time("snapshot", () => snapshotPage(tabId, opts)));
  const recommend = (url: string, title: string) => {
    resumeChecked = true;
    recommending = clock.time("recommend", () =>
      ensureRecommendedResume({ tabId, url, title, apiUrl, log }),
    );
  };
  /** Wait for the recommend before the run touches the page or moves tabs. */
  const settleRecommend = async () => {
    if (!recommending) return;
    enter(RUN_STAGE.recommending);
    const gate = await until(recommending);
    recommending = null;
    // No résumé, no action: the page is left exactly as it was.
    if (!gate.ok) throw noResumeStop(RUN_STAGE.recommending, snapshot, gate.reason);
  };

  const runState = (): RunProgress => ({
    runId,
    stage,
    startedAt,
    page: pageCount,
    refills: refillsOnPage,
    maxRefills: RUN_MAX_REFILLS_PER_PAGE,
    kind,
    control,
    mail: mailRows,
  });
  const progress = (message: string, phase: PipelineProgress["phase"] = "running") => {
    args.emit(tabs, { phase, message, run: runState() });
  };
  const enter = (next: RunStage, detail?: string) => {
    stage = next;
    progress(detail ?? STAGE_MESSAGE[next], next === RUN_STAGE.reading ? "analyzing" : "running");
  };

  const adoptTab = async (next: number) => {
    if (next === tabId) return;
    log.event("tab:adopted", { from: tabId, to: next });
    await rekeyTabJob(tabId, next);
    await rekeyCustomTab(tabId, next);
    tabId = next;
    tabs.push(next);
    usageMarks.push(markTabUsage(next).catch(() => null));
    args.claimTab(next);
  };

  /** Fill or Refill the page through the existing pipeline; its end is not the run's end. */
  /** Stop when the run has spent its AI budget: fills of this step, or model calls overall. */
  const checkBudget = async (within: PageSnapshot | null) => {
    const marks = (await Promise.all(usageMarks)).filter((mark): mark is UsageMark => mark != null);
    const used = await usageSince(marks, { settle: false }).catch(() => null);
    const calls = used?.calls ?? 0;
    const fills = current?.fills ?? 0;
    if (calls < RUN_MAX_AI_CALLS && fills < RUN_MAX_FILLS_PER_PAGE) return;
    const detail =
      calls >= RUN_MAX_AI_CALLS
        ? `${calls} model calls (limit ${RUN_MAX_AI_CALLS})`
        : `${fills} fills of this step (limit ${RUN_MAX_FILLS_PER_PAGE})`;
    log.event("budget:spent", { calls, fills });
    throw new RunStop(stage, within, [detail], undefined, {
      reason: RUN_FAILURE_REASON.budgetSpent,
      label: BUDGET_SPENT,
      detail,
    });
  };

  const fill = async (
    mode: FillMode,
    within: PageSnapshot,
    opts: { pendingOnly?: boolean; verificationCode?: string; history?: PlanTurn[] } = {},
  ) => {
    await checkBudget(within);
    checkStop();
    if (current) current.fills += 1;
    let last: PipelineProgress | undefined;
    const started = Date.now();
    await until(
      runFabPipeline({
        tabId,
        preferredFrameId: within.frameId,
        aiServerUrl: apiUrl,
        source: "fill",
        mode,
        history: opts.history,
        requireResume: true,
        pendingOnly: opts.pendingOnly,
        verificationCode: opts.verificationCode,
        signal,
        emitDomTree: (payload) => getAcornSocket()?.emit("dom:tree", payload),
        onProgress: (inner) => {
          // A fill cut short by Stop must not overwrite the stopped status.
          if (signal?.aborted) return;
          last = inner;
          const ended = inner.phase === "done" || inner.phase === "error";
          if (ended) progress(inner.message);
          else args.emit(tabs, { ...inner, run: runState() });
        },
      }),
    );
    const failed = last?.phase === "error";
    const fillShot = mode === FILL_MODE.refill ? "refill:done" : "fill:done";
    log.event(fillShot, {
      ok: !failed,
      message: last?.message,
      error: last?.error,
      steps: last?.steps?.length,
      durationMs: last?.durationMs,
      costUsd: last?.usage?.costUsd,
      phases: last?.phases,
    });
    await log.screenshot(fillShot);
    clock.add(mode === FILL_MODE.refill ? "refill" : "fill", Date.now() - started);
    // The fill stopped before anything else for want of a résumé file.
    const resumeMissing = failed && last?.message === NO_RESUME_FILE;
    return { failed, resumeMissing, error: last?.error, steps: last?.steps, plan: last?.plan };
  };

  /** A forward click the page ignored; past the limit the run stops. */
  const countNoEffect = (state: PageState, page: PageSnapshot) => {
    state.noEffect += 1;
    log.event("no-effect", { count: state.noEffect, limit: RUN_MAX_NO_EFFECT });
    if (state.noEffect > RUN_MAX_NO_EFFECT) {
      throw new RunStop(RUN_STAGE.advancing, page, [
        `Clicking "${control ?? "the control"}" ${state.noEffect} times changed nothing and the page flagged no field`,
      ]);
    }
  };

  /** Keep a plan the page ran, so a later Refill on this page continues from it. */
  const remember = (
    state: PageState,
    mode: FillMode,
    done: Awaited<ReturnType<typeof fill>>,
    fieldIssues?: FieldIssueScan,
  ) => {
    if (!done.plan?.actions?.length) return;
    state.turns = appendPlanTurn(state.turns, {
      mode,
      fieldIssues,
      plan: done.plan,
      steps: done.steps ?? [],
    });
  };

  const read = async (intent: ReadIntent, within: PageSnapshot) => {
    const res = await until(
      clock.time("decide", () =>
        requestReadPage(
          {
            runId,
            step: log.step,
            intent,
            url: within.url,
            title: within.title,
            text: within.text,
            controls: within.controls,
            flagged: within.flagged,
            pageMessages: within.scan.pageMessages,
            account: siteAttempts(within.url),
            accountGoal: accountGoal(within.url) ?? undefined,
          },
          apiUrl,
          tabId,
        ),
      ),
    );
    if (!res.ok || !res.kind) {
      throw new RunStop(RUN_STAGE.reading, within, [
        `Page read failed: ${res.error ?? "no answer"}`,
      ]);
    }
    kind = res.kind;
    pageAccountMode = res.accountMode ?? null;
    const find = (id?: number) =>
      id == null ? undefined : within.controls.find((candidate) => candidate.id === id);
    const picked = find(res.control?.id);
    const fallbackPicked = find(res.fallback?.id);
    log.event("read", {
      intent,
      kind: res.kind,
      kindConfidence: res.kindConfidence,
      verification: res.verification,
      accountMode: res.accountMode,
      controls: within.controls.length,
      flagged: within.flagged,
      pick: res.control
        ? {
            role: res.control.role,
            confidence: res.control.confidence,
            text: picked?.text || picked?.label,
          }
        : null,
      fallback: res.fallback
        ? {
            confidence: res.fallback.confidence,
            text: fallbackPicked?.text || fallbackPicked?.label,
            disabled: fallbackPicked?.disabled,
          }
        : null,
    });
    return {
      kind: res.kind,
      control: res.control ?? null,
      picked,
      fallback: res.fallback ?? null,
      fallbackPicked,
      guest: res.guest === true,
      needsPerson: res.needsPerson === true,
      verification: res.verification ?? VERIFICATION.none,
      /** The site says this applicant has already applied to this job. */
      alreadyApplied: res.alreadyApplied === true,
      accountMode: res.accountMode ?? ACCOUNT_MODE.none,
      /** False only when the backend says the profile has no default account password. */
      accountPassword: res.accountPassword !== false,
    };
  };

  /** Click the control, then wait for the page to react. Returns the page that follows. */
  const click = async (
    on: PageSnapshot,
    picked: NonNullable<Awaited<ReturnType<typeof read>>["control"]>,
    label: string,
  ): Promise<ClickOutcome> => {
    control = label;
    const started = Date.now();
    lastClickAt = started;
    checkStop();
    const beforeProbe = await until(probePage(tabId, on.frameId));
    const watcher = watchOpenedTabs(tabId);
    try {
      checkStop();
      const result = await until(clickControl(tabId, on.frameId, picked.id));
      log.event("click", { role: picked.role, text: label, ok: result.ok, error: result.error });
      // The page re-rendered since it was read (its node is gone) or held the
      // control: the caller reads it again rather than giving up.
      if (!result.ok)
        return { missed: result.error ?? "no answer", disabled: result.disabled === true };
      clickFailures = 0;
      const settled = await until(
        settleAfterClick({
          tabId,
          frameId: on.frameId,
          before: { url: on.url, signature: on.signature },
          beforeProbe,
          watcher,
        }),
      );
      log.event("settled", { how: settled.how, url: logUrl(settled.snapshot.url) });
      await adoptTab(settled.tabId);
      return { settled };
    } finally {
      watcher.stop();
      clock.add("click", Date.now() - started);
    }
  };

  /** Count a click that never landed; the loop then reads the page again and picks again. */
  const missedClick = (state: PageState, label: string, error: string) => {
    state.clicks -= 1;
    state.retryClick = true;
    clickFailures += 1;
    log.event("click:missed", { text: label, error, tries: clickFailures });
    if (clickFailures > RUN_MAX_CLICK_RETRIES) {
      throw new RunStop(stage, snapshot, [
        `Could not click "${label}" after ${clickFailures} fresh reads of the page: ${error}`,
      ]);
    }
  };

  /**
   * The page waits on something only the applicant can give: do nothing to it and
   * spend nothing, look again once they have moved it on.
   */
  const awaitPerson = async (page: PageSnapshot) => {
    log.event("wait:person", { url: logUrl(page.url) });
    progress(WAITING_FOR_PERSON);
    const moved = await until(clock.time("wait", () => waitForPerson(tabId, page.frameId, signal)));
    if (!moved) {
      throw new RunStop(stage, page, [WAITED_FOR_PERSON], undefined, {
        reason: RUN_FAILURE_REASON.waitedForPerson,
        label: WAITED_FOR_PERSON,
        detail: WAITED_FOR_PERSON,
      });
    }
    log.event("wait:done", {});
    // The applicant moved the page on: what follows is the page's answer, as after a click.
    const after = await snap({ form: true, frameId: page.frameId });
    return { snapshot: after, how: "changed" as SettleHow };
  };

  /**
   * The page that follows an account step is its answer: a new step means the
   * site took it; the same step saying something new (an alert, a flagged field,
   * new words) means it refused. The same step saying nothing is a click that had
   * no effect, not a refusal: it is left to the no-effect path and clicked again.
   * True when it was refused.
   */
  const settleAccount = (moved: boolean, page: PageSnapshot): boolean => {
    if (!accountSent) return false;
    const sent = accountSent;
    accountSent = null;
    // A reset request is answered by email, whatever the page shows: read the mail
    // next. Only a field the page flags (the email it needs) refuses it.
    if (
      sent.mode === ACCOUNT_MODE.resetPassword &&
      !resetLinkSites.has(sent.site) &&
      page.flagged === 0
    ) {
      accountHistory.push({
        site: sent.site,
        attempt: { mode: sent.mode, accepted: true, messages: [] },
      });
      log.event("account:reset-requested", {});
      mailExpected = true;
      return false;
    }
    // Only what the page says after the click is its answer; messages it already
    // showed (a form's own instructions) are not.
    const newMessages = page.scan.pageMessages.filter(
      (message) => !sent.messagesBefore.includes(message),
    );
    const said = moved ? [] : [...newMessages, ...newLines(sent.textBefore, page.text)];
    if (!moved && said.length === 0 && page.flagged === 0) {
      log.event("account:no-effect", { mode: sent.mode });
      return false;
    }
    const attempt: AccountAttempt = {
      mode: sent.mode,
      accepted: moved,
      messages: [...new Set(said)].slice(0, RUN_ACCOUNT_MESSAGES_MAX),
    };
    accountHistory.push({ site: sent.site, attempt });
    log.event(moved ? "account:accepted" : "account:rejected", { mode: sent.mode });
    // A refusal moves the account goal on (account-goal); the next read follows it.
    return !moved;
  };

  /**
   * The account step to work on this page, or a stop when every step was tried
   * on this site and refused.
   */
  const goalOrStop = (page: PageSnapshot): AccountMode => {
    const goal = accountGoal(page.url);
    if (goal) return goal;
    const detail = siteAttempts(page.url).at(-1)?.messages[0] ?? ACCOUNT_EXHAUSTED;
    throw new RunStop(RUN_STAGE.account, page, [ACCOUNT_EXHAUSTED, detail], undefined, {
      reason: RUN_FAILURE_REASON.accountRejected,
      label: ACCOUNT_REJECTED,
      detail,
    });
  };

  /**
   * A page that asks to verify by email after an account step is the site taking
   * that step: it sent the mail. A reset that answers "check your email" on the
   * same screen is done, not refused.
   */
  const acceptedByEmail = (page: PageSnapshot) => {
    const site = siteOf(page.url);
    const last = [...accountHistory].reverse().find((entry) => entry.site === site);
    if (!last || last.attempt.accepted) return;
    last.attempt = { ...last.attempt, accepted: true, messages: [] };
    log.event("account:accepted-by-email", { mode: last.attempt.mode });
  };

  /** Remember the account step a click is about to send, so its outcome is recorded. */
  const sendAccount = (page: PageSnapshot, mode: AccountMode) => {
    if (accountHistory.length >= RUN_MAX_ACCOUNT_ATTEMPTS) {
      const detail = `${accountHistory.length} account steps without getting past the site's account`;
      throw new RunStop(RUN_STAGE.account, page, [detail], undefined, {
        reason: RUN_FAILURE_REASON.accountRejected,
        label: ACCOUNT_REJECTED,
        detail,
      });
    }
    accountSent = {
      site: siteOf(page.url),
      mode,
      textBefore: page.text,
      messagesBefore: page.scan.pageMessages,
    };
    log.event("account:send", { mode });
  };

  const alreadyApplied = (page: PageSnapshot, detail: string) =>
    new RunStop(RUN_STAGE.reading, page, [ALREADY_APPLIED, detail], undefined, {
      reason: RUN_FAILURE_REASON.alreadyApplied,
      label: ALREADY_APPLIED,
      detail,
    });

  /**
   * A new page: the first one is the posting, checked against the postings applied
   * to already; on Continue, the page filled before the stop is not filled again.
   */
  const enterNewPage = async (page: PageSnapshot, state: PageState) => {
    if (!startUrl) {
      startUrl = page.url;
      const earlier = await appliedTo(startUrl);
      if (earlier) throw alreadyApplied(page, `Applied ${new Date(earlier.at).toLocaleString()}`);
    }
    if (resumeFilledSignature && page.signature === resumeFilledSignature) {
      state.filled = true;
      log.event("continue:filled-page", {});
    }
    resumeFilledSignature = null;
  };

  /** The site says this job was applied to already: stop before touching it. */
  const stopIfApplied = (r: { alreadyApplied: boolean }, page: PageSnapshot) => {
    if (r.alreadyApplied) throw alreadyApplied(page, "The site says this job was applied to");
  };

  /** An account step the run cannot sign in to or sign up on: the profile has no password. */
  const noAccountPassword = (page: PageSnapshot) =>
    new RunStop(RUN_STAGE.account, page, [NO_ACCOUNT_PASSWORD], undefined, {
      reason: RUN_FAILURE_REASON.noAccountPassword,
      label: NO_ACCOUNT_PASSWORD,
      detail: NO_ACCOUNT_PASSWORD,
    });

  const verificationNotFound = (page: PageSnapshot, detail: string) =>
    new RunStop(RUN_STAGE.verifying, page, [detail], undefined, {
      reason: RUN_FAILURE_REASON.verificationNotFound,
      label: VERIFICATION_NOT_FOUND,
      detail,
    });

  /**
   * Look in the applicant's Gmail for the code or link the site emailed, until it
   * arrives or the wait runs out. Jev ranks the newest emails and reads the best
   * one, then the second best; when neither holds it, the run stops. Null when no
   * Gmail is connected (the applicant does the step themselves).
   */
  const findInMail = async (kind: Verification, page: PageSnapshot): Promise<string | null> => {
    const wanted = kind === VERIFICATION.emailCode ? "code" : "link";
    let seen = "";
    let judgedNone = false;
    const started = Date.now();
    const say = () => {
      const waited = Math.round((Date.now() - started) / 1000);
      enter(
        RUN_STAGE.verifying,
        `Checking your latest emails for the ${wanted} the site sent${waited ? ` · ${waited}s` : ""}…`,
      );
    };
    mailRows = undefined;
    for (;;) {
      say();
      await checkBudget(page);
      const res = await until(
        clock.time("mail", () =>
          requestMailVerification(
            {
              runId,
              step: log.step,
              kind,
              url: page.url,
              title: page.title,
              text: page.text,
              since: lastClickAt,
              seen,
            },
            apiUrl,
            tabId,
          ),
        ),
      );
      // The code or link itself is never logged.
      log.event("mail:look", {
        kind,
        ok: res.ok,
        status: res.status,
        unchanged: res.unchanged,
        error: res.error,
      });
      if (!res.ok) {
        throw new RunStop(RUN_STAGE.verifying, page, [
          `Reading your Gmail failed: ${res.error ?? "no answer"}`,
        ]);
      }
      if (res.status === MAIL_VERIFICATION_STATUS.noMailbox) return null;
      if (res.status === MAIL_VERIFICATION_STATUS.found && res.value) return res.value;
      // Not in these emails: the site's may still be on its way. Keep watching; the
      // emails are judged again only once a new one arrives.
      if (res.status === MAIL_VERIFICATION_STATUS.notFound) judgedNone = true;
      seen = res.seen ?? seen;
      if (res.emails) {
        mailRows = res.emails;
        say();
      }
      if (Date.now() - started >= RUN_MAIL_WAIT_MAX_MS) {
        const minutes = Math.round(RUN_MAIL_WAIT_MAX_MS / 60_000);
        throw verificationNotFound(
          page,
          judgedNone
            ? `None of your latest emails held the ${wanted} within ${minutes} minutes`
            : `No email from the site arrived within ${minutes} minutes`,
        );
      }
      await until(sleep(RUN_MAIL_POLL_MS));
    }
  };

  /**
   * A page that waits on an emailed code or link: enter the code through the fill
   * engine, or open the link in this tab. Null when the page asks for neither;
   * "wait" when no Gmail is connected, so the applicant does it themselves.
   */
  const verifyByMail = async (
    r: Awaited<ReturnType<typeof read>>,
    page: PageSnapshot,
    state: PageState,
  ): Promise<null | "wait" | { pending: { snapshot: PageSnapshot; how: SettleHow } | null }> => {
    if (!MAIL_VERIFICATIONS.has(r.verification) || state.verified) return null;
    acceptedByEmail(page);
    return followMail(r.verification, page, state);
  };

  /**
   * Find the code or link the site emailed and use it: a code is entered through
   * the fill engine, a link is opened in this tab. "wait" when no Gmail is connected.
   */
  const followMail = async (
    kind: Verification,
    page: PageSnapshot,
    state: PageState,
  ): Promise<"wait" | { pending: { snapshot: PageSnapshot; how: SettleHow } | null }> => {
    if (mailVerifications >= RUN_MAX_MAIL_VERIFICATIONS) {
      throw verificationNotFound(
        page,
        `The site asked for ${mailVerifications} emailed codes or links without going on`,
      );
    }
    const value = await findInMail(kind, page);
    if (value == null) return "wait";
    mailVerifications += 1;

    if (kind === VERIFICATION.emailLink) {
      if (!isOpenableLink(value)) {
        throw verificationNotFound(page, "The link in the email is not a web address");
      }
      enter(RUN_STAGE.verifying, "Opening the link from your email…");
      checkStop();
      const opened = await until(clock.time("click", () => openLinkInTab(tabId, value)));
      log.event("mail:link-opened", { url: logUrl(opened.snapshot.url) });
      // A link that answers a reset request opens the form that sets the password.
      const site = siteOf(page.url);
      if (siteAttempts(page.url).at(-1)?.mode === ACCOUNT_MODE.resetPassword) {
        resetLinkSites.add(site);
      }
      return { pending: { snapshot: opened.snapshot, how: opened.how } };
    }

    enter(RUN_STAGE.filling, "Entering the code from your email…");
    state.fillStartedAt = Date.now();
    const filled = await fill(FILL_MODE.fill, page, { verificationCode: value });
    if (filled.failed) {
      throw new RunStop(
        RUN_STAGE.filling,
        page,
        [`Entering the emailed code failed: ${filled.error ?? "unknown"}`],
        filled.steps,
      );
    }
    log.event("mail:code-entered", {});
    state.verified = true;
    state.filled = true;
    // The next look is a fresh read of this page, not the outcome of a click.
    state.retryClick = true;
    return { pending: null };
  };

  /**
   * The first read of a page. A page still drawing itself reads as not an
   * application or blocked: wait for it to settle and look again before believing it.
   */
  const readUntilClear = async (start: PageSnapshot, state: PageState) => {
    let page = start;
    let first = await read(READ_INTENT.start, page);
    for (let look = 1; look <= RUN_UNCLEAR_REREADS && UNCLEAR_KINDS.has(first.kind); look += 1) {
      log.event("read:unclear", { kind: first.kind, look });
      enter(RUN_STAGE.reading, "Waiting for the page to finish loading…");
      await until(sleep(RUN_UNCLEAR_WAIT_MS));
      await until(waitForPageSettled(tabId));
      page = await snap({ form: false });
      snapshot = page;
      state.signature = page.signature;
      state.url = page.url;
      first = await read(READ_INTENT.start, page);
    }
    return { first, page };
  };

  type Handed = { pending: { snapshot: PageSnapshot; how: SettleHow } | null };

  /** What the mail gave, or the applicant's own move when no Gmail is connected. */
  const linkOrWait = async (
    mailed: Promise<"wait" | Handed>,
    page: PageSnapshot,
  ): Promise<Handed["pending"]> => {
    const got = await mailed;
    return got === "wait" ? awaitPerson(page) : got.pending;
  };

  /**
   * A page waiting on a verification: an emailed code or link is taken from the
   * mail; anything only the applicant can give is waited for. Null when the page
   * waits on neither.
   */
  const verifyOrWait = async (
    r: Awaited<ReturnType<typeof read>>,
    page: PageSnapshot,
    state: PageState,
  ): Promise<Handed | null> => {
    const mailed = await verifyByMail(r, page, state);
    if (mailed === "wait" || (mailed == null && r.needsPerson && !state.verified)) {
      return { pending: await awaitPerson(page) };
    }
    return mailed;
  };

  /**
   * Say what the forward click does. On an account step, only the goal's own form,
   * filled, is an attempt the site can refuse; any other click there just opens
   * the goal's form.
   */
  const announceForward = (
    page: PageSnapshot,
    click: { goal: AccountMode | null; pageMode: AccountMode; role: string; label: string },
  ) => {
    if (!click.goal) {
      const verb = click.role === CONTROL_ROLE.submit ? "Submitting" : "Next step";
      enter(RUN_STAGE.advancing, `${verb} · ${click.label}`);
      return;
    }
    if (page.fields > 0 && click.goal === click.pageMode) sendAccount(page, click.goal);
    enter(RUN_STAGE.account, `${ACCOUNT_MESSAGE[click.goal]} · ${click.label}`);
  };

  /** The control a read picked, or its fallback when it answered none. */
  const pickOf = (r: Awaited<ReturnType<typeof read>>) =>
    r.control && r.picked
      ? { control: r.control, picked: r.picked, fallback: false }
      : r.fallback && r.fallbackPicked
        ? { control: r.fallback, picked: r.fallbackPicked, fallback: true }
        : null;

  const diagnose = async (stop: RunStop): Promise<RunFailure> => {
    enter(RUN_STAGE.diagnosing);
    const evidence = failureEvidence({
      snapshot: stop.snapshot,
      steps: stop.steps,
      notes: stop.notes,
    });
    log.event("diagnose:start", {
      stage: stop.stage,
      evidence: evidence.length,
      refills: refillsOnPage,
    });
    const fallbackDetail = evidence.slice(0, 3).join(" · ");
    try {
      const res = await clock.time("diagnose", () =>
        requestDiagnose(
          {
            runId,
            step: log.step,
            stage: stop.stage,
            attempts: refillsOnPage,
            url: stop.snapshot?.url ?? "",
            title: stop.snapshot?.title ?? "",
            text: stop.snapshot?.text ?? "",
            evidence,
          },
          apiUrl,
          tabId,
        ),
      );
      if (res.ok && res.reason) {
        log.event("diagnose:done", { reason: res.reason, confidence: res.confidence });
        return {
          reason: res.reason,
          label: res.label || UNKNOWN_FAILURE_LABEL,
          detail: res.detail || fallbackDetail,
          stage: stop.stage,
        };
      }
      log.event("diagnose:failed", { error: res.error });
    } catch (err) {
      log.event("diagnose:failed", { error: err instanceof Error ? err.message : String(err) });
    }
    return {
      reason: UNKNOWN_FAILURE_REASON,
      label: UNKNOWN_FAILURE_LABEL,
      detail: fallbackDetail,
      stage: stop.stage,
    };
  };

  const report = (outcome: RunReport["outcome"], failure?: RunFailure): RunReport => ({
    outcome,
    pages: pageCount,
    refills: refillsTotal,
    failure,
  });

  const finish = async (result: RunReport): Promise<RunReport> => {
    const failed = result.outcome === RUN_OUTCOME.failed;
    const halted = result.outcome === RUN_OUTCOME.stopped;
    const ready = result.outcome === RUN_OUTCOME.readyToSubmit;
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    const marks = (await Promise.all(usageMarks)).filter((mark): mark is UsageMark => mark != null);
    const usage = await usageSince(marks).catch(() => null);
    log.event("run:end", {
      outcome: result.outcome,
      pages: result.pages,
      refills: result.refills,
      seconds,
      reason: result.failure?.reason,
      detail: result.failure?.detail,
      phases: clock.summary(),
      calls: usage?.calls,
      costUsd: usage?.costUsd,
    });
    await log.screenshot("run:end");
    const cost = usage ? ` · ${formatUsd(usage.costUsd)}` : "";
    const message = halted
      ? `Stopped by you · ${seconds}s${cost}`
      : ready
        ? `Ready to submit · ${result.pages} page${result.pages === 1 ? "" : "s"} · ${seconds}s${cost}`
        : failed
          ? `Stopped · ${result.failure?.label ?? UNKNOWN_FAILURE_LABEL}`
          : `Done · ${result.pages} page${result.pages === 1 ? "" : "s"} · ${seconds}s${cost}`;
    const canContinue = await keepRunEnd(tabId, result.outcome, snapshot?.title ?? "", {
      accountHistory,
      resetLinkSites: [...resetLinkSites],
      mailVerifications,
      filledSignature: current?.filled ? current.signature : null,
      startUrl,
      pages: pageCount,
    });
    const run: RunProgress = { ...runState(), endedAt: Date.now(), report: result, canContinue };
    args.emit(tabs, {
      phase: failed ? "error" : halted ? "idle" : "done",
      message,
      error: failed
        ? [result.failure?.label, result.failure?.detail].filter(Boolean).join(": ")
        : undefined,
      durationMs: Date.now() - startedAt,
      usage,
      run,
    });
    await log.flush();
    return result;
  };

  log.event("run:start", { tabId, maxRefills: RUN_MAX_REFILLS_PER_PAGE, maxSteps: RUN_MAX_STEPS });
  progress("Starting…", "fetching");

  try {
    /** The page a click just produced, and how that click settled. */
    let pending: { snapshot: PageSnapshot; how: SettleHow } | null = null;

    while (log.step < RUN_MAX_STEPS) {
      checkStop();
      log.step += 1;
      await checkBudget(snapshot);

      // 1. Look at the page: the one a click just produced, or a fresh read.
      let page: PageSnapshot;
      let settled: SettleHow | null = null;
      if (pending) {
        page = pending.snapshot;
        settled = pending.how;
        pending = null;
      } else {
        enter(RUN_STAGE.reading);
        page = await snap({
          form: current?.filled === true,
          frameId: snapshot?.frameId,
        });
      }
      snapshot = page;

      const moved = isNewStep({ previous: current, page, settled });
      if (!moved && current) {
        current.signature = page.signature;
        current.url = page.url;
      }
      if (moved) {
        pageAccountMode = null;
        pageCount += 1;
        if (pageCount > RUN_MAX_PAGES) {
          throw new RunStop(stage, page, [
            `The run went through ${RUN_MAX_PAGES} pages without finishing`,
          ]);
        }
        current = {
          signature: page.signature,
          url: page.url,
          filled: false,
          clicks: 0,
          refills: 0,
          noEffect: 0,
          scanBeforeClick: null,
          scanBeforeFill: null,
          turns: [],
          fillStartedAt: 0,
          retryClick: false,
          blockedPasses: 0,
          fills: 0,
          verified: false,
        };
        refillsOnPage = 0;
        log.event("page", { page: pageCount, url: logUrl(page.url), flagged: page.flagged });
        await log.screenshot("page");
        await enterNewPage(page, current);
      }
      const state = current as PageState;
      const retrying = state.retryClick;
      state.retryClick = false;
      // An account step the site refused is answered by another account step, not a refill.
      const accountRefused = settleAccount(moved, page);
      if (mailExpected) {
        mailExpected = false;
        pending = await linkOrWait(followMail(VERIFICATION.emailLink, page, state), page);
        continue;
      }

      // 2. The same page after a click: the page rejected the answers, or nothing happened.
      if (!moved && state.clicks > 0 && !retrying && !accountRefused) {
        // Only what the click flagged: a hint the page always shows is no rejection.
        const flagged = countFlaggedSince(state.scanBeforeClick, page.scan);
        const missing = countRequiredEmpty(page.scan);
        // A page with no ARIA rejects an answer in plain copy beside the field.
        const noted = countNotedSince(state.scanBeforeFill ?? state.scanBeforeClick, page.scan);
        log.event("after-click", { flagged, missing, noted, shown: page.flagged });
        const onlyNoted = flagged === 0 && missing === 0;
        if (flagged > 0 || missing > 0 || noted > 0) {
          if (state.refills >= RUN_MAX_REFILLS_PER_PAGE) {
            throw new RunStop(RUN_STAGE.refilling, page, [
              `Still flagged after ${state.refills} refills (limit ${RUN_MAX_REFILLS_PER_PAGE})`,
            ]);
          }
          state.refills += 1;
          refillsOnPage = state.refills;
          refillsTotal += 1;
          enter(
            RUN_STAGE.refilling,
            `Refill ${state.refills}/${RUN_MAX_REFILLS_PER_PAGE} · ${flagged + missing + noted} to fix`,
          );
          const flaggedScan = page.scan;
          const refilled = await fill(FILL_MODE.refill, page, { history: state.turns });
          if (refilled.failed) {
            throw new RunStop(
              RUN_STAGE.refilling,
              page,
              [`Refill failed: ${refilled.error ?? "unknown"}`],
              refilled.steps,
            );
          }
          remember(state, FILL_MODE.refill, refilled, flaggedScan);
          // The planner read the new text and found nothing to fix: it is the page's
          // copy, not a rejection. Stop asking about it; the click changed nothing.
          if (onlyNoted && !refilled.steps?.length) {
            state.scanBeforeFill = flaggedScan;
            log.event("refill:nothing-to-fix", { noted });
            countNoEffect(state, page);
          }
        } else {
          countNoEffect(state, page);
        }
        page = await snap({ form: true, frameId: page.frameId });
        snapshot = page;
      } else if (!state.filled) {
        // 3. A page seen for the first time: what is it? A tab bound to a job can
        // have its résumé recommended while the page is read.
        if (!resumeChecked && (await getTabJob(tabId))) recommend(page.url, page.title);
        const looked = await readUntilClear(page, state);
        const first = looked.first;
        page = looked.page;
        if (first.kind === PAGE_KIND.confirmation) {
          return await finish(report(RUN_OUTCOME.completed));
        }
        stopIfApplied(first, page);
        if (first.kind === PAGE_KIND.blocked || first.kind === PAGE_KIND.other) {
          throw new RunStop(RUN_STAGE.reading, page, [
            `This page is ${first.kind.replace("_", " ")}`,
          ]);
        }

        if (!resumeChecked) recommend(page.url, page.title);
        await settleRecommend();

        const handed = await verifyOrWait(first, page, state);
        if (handed) {
          pending = handed.pending;
          continue;
        }

        if (first.kind === PAGE_KIND.posting) {
          if (!first.control || !first.picked) {
            throw new RunStop(RUN_STAGE.applying, page, [
              "No way to apply was found on the posting",
            ]);
          }
          state.clicks += 1;
          enter(
            RUN_STAGE.applying,
            `Opening the application · ${first.picked.text || first.picked.label}`,
          );
          const label = first.picked.text || first.picked.label;
          const clicked = await click(page, first.control, label);
          if (clicked.missed != null) missedClick(state, label, clicked.missed);
          else pending = { snapshot: clicked.settled.snapshot, how: clicked.settled.how };
          continue;
        }

        let skipFill: string | null = page.fields === 0 ? "no fields on the page" : null;
        // An account step: go on without an account when the page offers it.
        if (first.kind === PAGE_KIND.accountStep) {
          const target = pickOf(first);
          // Once the account order brought the run to the goal's own form, that
          // form is sent; going on as a guest is taken only from any other page.
          if (first.guest && target && first.accountMode !== accountGoal(page.url)) {
            state.clicks += 1;
            const label = target.picked.text || target.picked.label;
            enter(RUN_STAGE.applying, `Going on without an account · ${label}`);
            const clicked = await click(page, target.control, label);
            if (clicked.missed != null) missedClick(state, label, clicked.missed);
            else pending = { snapshot: clicked.settled.snapshot, how: clicked.settled.how };
            continue;
          }
          // The account is mandatory. The goal comes from the fixed order and this
          // site's history; the page's own form is filled only when it is the goal's
          // form (the applicant's email and name, the profile's default password).
          // Otherwise nothing is filled and the control that opens the goal's form
          // is clicked below.
          if (!first.accountPassword) throw noAccountPassword(page);
          const goal = goalOrStop(page);
          enter(RUN_STAGE.account, `${ACCOUNT_MESSAGE[goal]}…`);
          if (goal !== first.accountMode) {
            log.event("account:open", { goal, page: first.accountMode });
            skipFill = `the page shows ${first.accountMode}, the goal is ${goal}`;
          }
        }

        // An application form: fill it, then look again for the control that moves it
        // on. A page that asks for nothing goes straight to that control.
        if (skipFill) {
          log.event("fill:skipped", { reason: skipFill });
          state.filled = true;
        } else {
          enter(RUN_STAGE.filling);
          state.fillStartedAt = Date.now();
          state.scanBeforeFill = page.scan;
          const filled = await fill(FILL_MODE.fill, page);
          if (filled.resumeMissing) {
            throw noResumeStop(RUN_STAGE.filling, page, filled.error ?? RESUME_NOT_CHOSEN);
          }
          if (filled.failed) {
            throw new RunStop(
              RUN_STAGE.filling,
              page,
              [`Fill failed: ${filled.error ?? "unknown"}`],
              filled.steps,
            );
          }
          remember(state, FILL_MODE.fill, filled);
          state.filled = true;
          page = await snap({ form: true, frameId: page.frameId });
          snapshot = page;
        }
      }

      // 4. A filled page: put back what the page cleared since the fill, then click
      // the control that moves the application forward. The click comes before any
      // verdict: a page that looks stuck often answers it by showing what it needs.
      enter(RUN_STAGE.advancing);
      if (state.fillStartedAt > 0) {
        checkStop();
        const drift = await until(repairDriftInTab(tabId, page.frameId, state.fillStartedAt));
        if (drift.checked) log.event("drift", { ...drift });
        if (drift.repaired > 0) {
          page = await snap({ form: true, frameId: page.frameId });
          snapshot = page;
        }
      }
      const next = await read(READ_INTENT.advance, page);
      if (next.kind === PAGE_KIND.confirmation) {
        return await finish(report(RUN_OUTCOME.completed));
      }
      stopIfApplied(next, page);
      const handed = await verifyOrWait(next, page, state);
      if (handed) {
        pending = handed.pending;
        continue;
      }
      const guestPath = next.guest && next.accountMode !== accountGoal(page.url);
      const sendsAccount = next.kind === PAGE_KIND.accountStep && !guestPath;
      if (sendsAccount && !next.accountPassword) throw noAccountPassword(page);
      const goal = sendsAccount ? goalOrStop(page) : null;
      const target = pickOf(next);
      if (!target) {
        // After a click, a missing control is the page holding the click (busy,
        // disabled, waiting on a check), not a page that never had one.
        const notes =
          state.clicks > 0 && control
            ? [
                `"${control}" was clicked ${state.clicks} time${state.clicks === 1 ? "" : "s"}; the page stayed on this step and no longer offers a control that moves it forward`,
              ]
            : ["No control on the page moves the application forward"];
        throw new RunStop(RUN_STAGE.advancing, page, notes);
      }
      state.clicks += 1;
      state.scanBeforeClick = page.scan;
      // The next look is compared with the page as it was clicked: the fill itself
      // changes a page's fields (rows added, follow-ups revealed).
      state.signature = page.signature;
      state.url = page.url;
      const label = target.picked.text || target.picked.label;
      if (target.fallback) {
        log.event("click:fallback", { text: label, disabled: target.picked.disabled });
      }
      // Stop before Submit: the last step is filled; sending it is left to the person.
      if (args.stopBeforeSubmit && !goal && target.control.role === CONTROL_ROLE.submit) {
        log.event("run:ready-to-submit", { control: label });
        return await finish(report(RUN_OUTCOME.readyToSubmit));
      }
      announceForward(page, { goal, pageMode: next.accountMode, role: target.control.role, label });
      const clicked = await click(page, target.control, label);
      // A click that never landed sent no account step.
      if (!clicked.settled) accountSent = null;
      if (clicked.settled) {
        pending = { snapshot: clicked.settled.snapshot, how: clicked.settled.how };
      } else if (clicked.disabled) {
        // The page holds its forward control until it has what it needs: answer what
        // is still blank or off, put back what it cleared, then click again.
        state.clicks -= 1;
        state.retryClick = true;
        if (state.blockedPasses >= RUN_MAX_BLOCKED_PASSES) {
          throw new RunStop(RUN_STAGE.advancing, page, [
            `"${label}" stayed disabled after ${state.blockedPasses} passes over what the page still needed`,
            ...(await unansweredNotes(tabId, page.frameId)),
          ]);
        }
        state.blockedPasses += 1;
        log.event("blocked", { control: label, pass: state.blockedPasses });
        enter(RUN_STAGE.filling, `Answering what "${label}" is waiting on`);
        const completed = await fill(FILL_MODE.fill, page, { pendingOnly: true });
        if (completed.resumeMissing) {
          throw noResumeStop(RUN_STAGE.filling, page, completed.error ?? RESUME_NOT_CHOSEN);
        }
      } else {
        missedClick(state, label, clicked.missed);
      }
    }
    throw new RunStop(stage, snapshot, [`The run used ${RUN_MAX_STEPS} steps without finishing`]);
  } catch (err) {
    const stop =
      err instanceof RunStop
        ? err
        : new RunStop(stage, snapshot, [err instanceof Error ? err.message : String(err)]);
    log.event("run:stop", { stage: stop.stage, notes: stop.notes });
    if (signal?.aborted) {
      return finish(report(RUN_OUTCOME.stopped, { ...STOPPED_FAILURE, stage: stop.stage }));
    }
    const failure = stop.known ? { ...stop.known, stage: stop.stage } : await diagnose(stop);
    return finish(report(RUN_OUTCOME.failed, failure));
  }
}
