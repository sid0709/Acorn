import { formatUsd } from "@acorn/shared/ai-usage";
import {
  FILL_MODE,
  countFlaggedSince,
  countRequiredEmpty,
  type FieldIssueScan,
  type FillMode,
} from "@acorn/shared/field-issues";
import { PhaseClock } from "@acorn/shared/phase-clock";
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

import {
  requestDiagnose,
  requestMailVerification,
  requestReadPage,
  READ_INTENT,
  type ReadIntent,
} from "./api/run";
import { repairDriftInTab } from "./drift";
import { fetchDomFromTab } from "./fetch-dom";
import { RESUME_NOT_CHOSEN, type ResumeGate } from "./resume-gate";
import {
  clickControl,
  isOpenableLink,
  openLinkInTab,
  probePage,
  sleep,
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
  RUN_MAX_ACCOUNT_REJECTS,
  RUN_MAX_AI_CALLS,
  RUN_MAX_MAIL_VERIFICATIONS,
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
import { isNewStep } from "./run-step";
import { NO_RESUME_FILE, runFabPipeline } from "./run-pipeline";
import { ensureRecommendedResume } from "./run-resume";

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
/** The site needs an account and the profile has no password to give it. */
const NO_ACCOUNT_PASSWORD =
  "This site needs an account: add a default account password to your Acorn profile";

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

function newRunId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Run: read the page, recommend a résumé, open the application, then fill each page
 * and move on (Next or Submit) until the application is complete. A page that
 * rejects the answers is refilled up to a limit. Every "what is this page" and
 * "what do I click" is a decision by the model (Jev), never a match on button text.
 */
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
  let pageCount = 0;
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
  const accountHistory: { site: string; attempt: AccountAttempt }[] = [];
  /** The account step the last click sent; its outcome is the page that follows. */
  let accountSent: { site: string; mode: AccountMode } | null = null;
  /** When the run last clicked: an email the site sent for this step arrived after it. */
  let lastClickAt = 0;
  /** Codes and links taken from the applicant's mail so far. */
  let mailVerifications = 0;
  const clock = new PhaseClock();
  const snap = (opts: Parameters<typeof snapshotPage>[1]) =>
    clock.time("snapshot", () => snapshotPage(tabId, opts));
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
    const gate = await recommending;
    recommending = null;
    // No résumé, no action: the page is left exactly as it was.
    if (!gate.ok) throw noResumeStop(RUN_STAGE.recommending, snapshot, gate.reason);
  };

  const runState = (): RunProgress => ({
    runId,
    stage,
    page: pageCount,
    refills: refillsOnPage,
    maxRefills: RUN_MAX_REFILLS_PER_PAGE,
    kind,
    control,
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
    opts: { pendingOnly?: boolean; verificationCode?: string } = {},
  ) => {
    await checkBudget(within);
    if (current) current.fills += 1;
    let last: PipelineProgress | undefined;
    const started = Date.now();
    await runFabPipeline({
      tabId,
      preferredFrameId: within.frameId,
      aiServerUrl: apiUrl,
      source: "fill",
      mode,
      requireResume: true,
      pendingOnly: opts.pendingOnly,
      verificationCode: opts.verificationCode,
      emitDomTree: (payload) => getAcornSocket()?.emit("dom:tree", payload),
      onProgress: (inner) => {
        last = inner;
        const ended = inner.phase === "done" || inner.phase === "error";
        if (ended) progress(inner.message);
        else args.emit(tabs, { ...inner, run: runState() });
      },
    });
    const failed = last?.phase === "error";
    log.event(mode === FILL_MODE.refill ? "refill:done" : "fill:done", {
      ok: !failed,
      message: last?.message,
      error: last?.error,
      steps: last?.steps?.length,
      durationMs: last?.durationMs,
      costUsd: last?.usage?.costUsd,
      phases: last?.phases,
    });
    clock.add(mode === FILL_MODE.refill ? "refill" : "fill", Date.now() - started);
    // The fill stopped before anything else for want of a résumé file.
    const resumeMissing = failed && last?.message === NO_RESUME_FILE;
    return { failed, resumeMissing, error: last?.error, steps: last?.steps };
  };

  const read = async (intent: ReadIntent, within: PageSnapshot) => {
    const res = await clock.time("decide", () =>
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
          account: accountHistory
            .filter((entry) => entry.site === siteOf(within.url))
            .map((entry) => entry.attempt),
        },
        apiUrl,
        tabId,
      ),
    );
    if (!res.ok || !res.kind) {
      throw new RunStop(RUN_STAGE.reading, within, [
        `Page read failed: ${res.error ?? "no answer"}`,
      ]);
    }
    kind = res.kind;
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
    const beforeProbe = await probePage(tabId, on.frameId);
    const watcher = watchOpenedTabs(tabId);
    try {
      const result = await clickControl(tabId, on.frameId, picked.id);
      log.event("click", { role: picked.role, text: label, ok: result.ok, error: result.error });
      // The page re-rendered since it was read (its node is gone) or held the
      // control: the caller reads it again rather than giving up.
      if (!result.ok)
        return { missed: result.error ?? "no answer", disabled: result.disabled === true };
      clickFailures = 0;
      const settled = await settleAfterClick({
        tabId,
        frameId: on.frameId,
        before: { url: on.url, signature: on.signature },
        beforeProbe,
        watcher,
      });
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
    const moved = await clock.time("wait", () => waitForPerson(tabId, page.frameId));
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
   * site took it; the same step means it refused. A step refused too often stops
   * the run. True when the last click's account step was refused.
   */
  const settleAccount = (moved: boolean, page: PageSnapshot): boolean => {
    if (!accountSent) return false;
    const sent = accountSent;
    accountSent = null;
    const attempt: AccountAttempt = {
      mode: sent.mode,
      accepted: moved,
      messages: moved ? [] : page.scan.pageMessages.slice(0, RUN_ACCOUNT_MESSAGES_MAX),
    };
    accountHistory.push({ site: sent.site, attempt });
    log.event(moved ? "account:accepted" : "account:rejected", { mode: sent.mode });
    if (moved) return false;
    const refused = accountHistory.filter(
      (entry) =>
        entry.site === sent.site && entry.attempt.mode === sent.mode && !entry.attempt.accepted,
    ).length;
    if (refused >= RUN_MAX_ACCOUNT_REJECTS) {
      const detail =
        attempt.messages[0] ?? `${ACCOUNT_MESSAGE[sent.mode]} was refused ${refused} times`;
      throw new RunStop(RUN_STAGE.account, page, [detail], undefined, {
        reason: RUN_FAILURE_REASON.accountRejected,
        label: ACCOUNT_REJECTED,
        detail,
      });
    }
    return true;
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
    accountSent = { site: siteOf(page.url), mode };
    log.event("account:send", { mode });
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
    enter(
      RUN_STAGE.verifying,
      kind === VERIFICATION.emailCode
        ? "Looking in your Gmail for the code the site sent…"
        : "Looking in your Gmail for the link the site sent…",
    );
    let ruledOut: string[] = [];
    const started = Date.now();
    for (;;) {
      await checkBudget(page);
      const res = await clock.time("mail", () =>
        requestMailVerification(
          {
            runId,
            step: log.step,
            kind,
            url: page.url,
            title: page.title,
            text: page.text,
            since: lastClickAt,
            ruledOut,
          },
          apiUrl,
          tabId,
        ),
      );
      // The code or link itself is never logged.
      log.event("mail:look", { kind, ok: res.ok, status: res.status, error: res.error });
      if (!res.ok) {
        throw new RunStop(RUN_STAGE.verifying, page, [
          `Reading your Gmail failed: ${res.error ?? "no answer"}`,
        ]);
      }
      if (res.status === MAIL_VERIFICATION_STATUS.noMailbox) return null;
      if (res.status === MAIL_VERIFICATION_STATUS.found && res.value) return res.value;
      if (res.status === MAIL_VERIFICATION_STATUS.notFound) {
        throw verificationNotFound(
          page,
          "The site's most likely emails hold no code or link for this step",
        );
      }
      ruledOut = res.ruledOut ?? ruledOut;
      if (Date.now() - started >= RUN_MAIL_WAIT_MAX_MS) {
        throw verificationNotFound(
          page,
          `No email from the site arrived within ${Math.round(RUN_MAIL_WAIT_MAX_MS / 60_000)} minutes`,
        );
      }
      await sleep(RUN_MAIL_POLL_MS);
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
    if (mailVerifications >= RUN_MAX_MAIL_VERIFICATIONS) {
      throw verificationNotFound(
        page,
        `The site asked for ${mailVerifications} emailed codes or links without going on`,
      );
    }
    const value = await findInMail(r.verification, page);
    if (value == null) return "wait";
    mailVerifications += 1;

    if (r.verification === VERIFICATION.emailLink) {
      if (!isOpenableLink(value)) {
        throw verificationNotFound(page, "The link in the email is not a web address");
      }
      enter(RUN_STAGE.verifying, "Opening the link from your email…");
      const opened = await clock.time("click", () => openLinkInTab(tabId, value));
      log.event("mail:link-opened", { url: logUrl(opened.snapshot.url) });
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
    const cost = usage ? ` · ${formatUsd(usage.costUsd)}` : "";
    const message = failed
      ? `Stopped · ${result.failure?.label ?? UNKNOWN_FAILURE_LABEL}`
      : `Done · ${result.pages} page${result.pages === 1 ? "" : "s"} · ${seconds}s${cost}`;
    const run: RunProgress = { ...runState(), report: result };
    args.emit(tabs, {
      phase: failed ? "error" : "done",
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
          fillStartedAt: 0,
          retryClick: false,
          blockedPasses: 0,
          fills: 0,
          verified: false,
        };
        refillsOnPage = 0;
        log.event("page", { page: pageCount, url: logUrl(page.url), flagged: page.flagged });
      }
      const state = current as PageState;
      const retrying = state.retryClick;
      state.retryClick = false;
      // An account step the site refused is answered by another account step, not a refill.
      const accountRefused = settleAccount(moved, page);

      // 2. The same page after a click: the page rejected the answers, or nothing happened.
      if (!moved && state.clicks > 0 && !retrying && !accountRefused) {
        // Only what the click flagged: a hint the page always shows is no rejection.
        const flagged = countFlaggedSince(state.scanBeforeClick, page.scan);
        const missing = countRequiredEmpty(page.scan);
        log.event("after-click", { flagged, missing, shown: page.flagged });
        if (flagged > 0 || missing > 0) {
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
            `Refill ${state.refills}/${RUN_MAX_REFILLS_PER_PAGE} · ${flagged + missing} to fix`,
          );
          const refilled = await fill(FILL_MODE.refill, page);
          if (refilled.failed) {
            throw new RunStop(
              RUN_STAGE.refilling,
              page,
              [`Refill failed: ${refilled.error ?? "unknown"}`],
              refilled.steps,
            );
          }
        } else {
          state.noEffect += 1;
          log.event("no-effect", { count: state.noEffect, limit: RUN_MAX_NO_EFFECT });
          if (state.noEffect > RUN_MAX_NO_EFFECT) {
            throw new RunStop(RUN_STAGE.advancing, page, [
              `Clicking "${control ?? "the control"}" ${state.noEffect} times changed nothing and the page flagged no field`,
            ]);
          }
        }
        page = await snap({ form: true, frameId: page.frameId });
        snapshot = page;
      } else if (!state.filled) {
        // 3. A page seen for the first time: what is it? A tab bound to a job can
        // have its résumé recommended while the page is read.
        if (!resumeChecked && (await getTabJob(tabId))) recommend(page.url, page.title);
        const first = await read(READ_INTENT.start, page);
        if (first.kind === PAGE_KIND.confirmation) {
          return await finish(report(RUN_OUTCOME.completed));
        }
        if (first.kind === PAGE_KIND.blocked || first.kind === PAGE_KIND.other) {
          throw new RunStop(RUN_STAGE.reading, page, [
            `This page is ${first.kind.replace("_", " ")}`,
          ]);
        }

        if (!resumeChecked) recommend(page.url, page.title);
        await settleRecommend();

        const mailed = await verifyByMail(first, page, state);
        if (mailed === "wait" || (mailed == null && first.needsPerson)) {
          pending = await awaitPerson(page);
          continue;
        }
        if (mailed) {
          pending = mailed.pending;
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

        // An account step: go on without an account when the page offers it.
        if (first.kind === PAGE_KIND.accountStep) {
          const target = pickOf(first);
          if (first.guest && target) {
            state.clicks += 1;
            const label = target.picked.text || target.picked.label;
            enter(RUN_STAGE.applying, `Going on without an account · ${label}`);
            const clicked = await click(page, target.control, label);
            if (clicked.missed != null) missedClick(state, label, clicked.missed);
            else pending = { snapshot: clicked.settled.snapshot, how: clicked.settled.how };
            continue;
          }
          // The account is mandatory: fill it like a form (the applicant's email and
          // the profile's default account password), then send it below.
          if (!first.accountPassword) throw noAccountPassword(page);
          enter(RUN_STAGE.account, `${ACCOUNT_MESSAGE[first.accountMode]}…`);
        }

        // An application form: fill it, then look again for the control that moves it
        // on. A page that asks for nothing goes straight to that control.
        if (page.fields === 0) {
          log.event("fill:skipped", { reason: "no fields on the page" });
          state.filled = true;
        } else {
          enter(RUN_STAGE.filling);
          state.fillStartedAt = Date.now();
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
        const drift = await repairDriftInTab(tabId, page.frameId, state.fillStartedAt);
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
      const mailed = await verifyByMail(next, page, state);
      if (mailed === "wait" || (mailed == null && next.needsPerson && !state.verified)) {
        pending = await awaitPerson(page);
        continue;
      }
      if (mailed) {
        pending = mailed.pending;
        continue;
      }
      const sendsAccount = next.kind === PAGE_KIND.accountStep && !next.guest;
      if (sendsAccount && !next.accountPassword) throw noAccountPassword(page);
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
      const label = target.picked.text || target.picked.label;
      if (target.fallback) {
        log.event("click:fallback", { text: label, disabled: target.picked.disabled });
      }
      if (sendsAccount) {
        sendAccount(page, next.accountMode);
        enter(RUN_STAGE.account, `${ACCOUNT_MESSAGE[next.accountMode]} · ${label}`);
      } else {
        enter(
          RUN_STAGE.advancing,
          `${target.control.role === CONTROL_ROLE.submit ? "Submitting" : "Next step"} · ${label}`,
        );
      }
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
    const failure = stop.known ? { ...stop.known, stage: stop.stage } : await diagnose(stop);
    return finish(report(RUN_OUTCOME.failed, failure));
  }
}
