import {
  FILL_MODE,
  countFlaggedSince,
  countRequiredEmpty,
  type FieldIssueScan,
  type FillMode,
} from "@acorn/shared/field-issues";
import {
  CONTROL_ROLE,
  PAGE_KIND,
  RUN_FAILURE_REASON,
  RUN_OUTCOME,
  RUN_STAGE,
  type PageKind,
  type RunFailure,
  type RunProgress,
  type RunReport,
  type RunStage,
} from "@acorn/shared/run-types";

import { formatUsd } from "@acorn/shared/ai-usage";
import { PhaseClock } from "@acorn/shared/phase-clock";

import { getAcornSocket } from "../acorn-socket";
import { markTabUsage, usageSince, type UsageMark } from "../background/tab-usage-store";
import { rekeyCustomTab } from "../tab-custom-session";
import { getTabJob, rekeyTabJob } from "../tab-job-session";

import { requestDiagnose, requestReadPage, READ_INTENT, type ReadIntent } from "./api/run";
import { repairDriftInTab } from "./drift";
import { clickControl, probePage, settleAfterClick, watchOpenedTabs } from "./run-click";
import { failureEvidence } from "./run-evidence";
import {
  RUN_MAX_BLOCKED_PASSES,
  RUN_MAX_CLICK_RETRIES,
  RUN_MAX_NO_EFFECT,
  RUN_MAX_PAGES,
  RUN_MAX_REFILLS_PER_PAGE,
  RUN_MAX_STEPS,
} from "./run-limits";
import { logUrl, RunLog } from "./run-log";
import { snapshotPage, type PageSnapshot } from "./run-page";
import { RESUME_NOT_CHOSEN, type ResumeGate } from "./resume-gate";
import { ensureRecommendedResume } from "./run-resume";
import { NO_RESUME_FILE, runFabPipeline } from "./run-pipeline";

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
  [RUN_STAGE.diagnosing]: "Working out what went wrong…",
};

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
  signature: string;
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
  const fill = async (
    mode: FillMode,
    within: PageSnapshot,
    opts: { pendingOnly?: boolean } = {},
  ) => {
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
    let pending: PageSnapshot | null = null;

    while (log.step < RUN_MAX_STEPS) {
      log.step += 1;

      // 1. Look at the page: the one a click just produced, or a fresh read.
      let page: PageSnapshot;
      if (pending) {
        page = pending;
        pending = null;
      } else {
        enter(RUN_STAGE.reading);
        page = await snap({
          form: current?.filled === true,
          frameId: snapshot?.frameId,
        });
      }
      snapshot = page;

      const moved = current == null || page.signature !== current.signature;
      if (moved) {
        pageCount += 1;
        if (pageCount > RUN_MAX_PAGES) {
          throw new RunStop(stage, page, [
            `The run went through ${RUN_MAX_PAGES} pages without finishing`,
          ]);
        }
        current = {
          signature: page.signature,
          filled: false,
          clicks: 0,
          refills: 0,
          noEffect: 0,
          scanBeforeClick: null,
          fillStartedAt: 0,
          retryClick: false,
          blockedPasses: 0,
        };
        refillsOnPage = 0;
        log.event("page", { page: pageCount, url: logUrl(page.url), flagged: page.flagged });
      }
      const state = current as PageState;
      const retrying = state.retryClick;
      state.retryClick = false;

      // 2. The same page after a click: the page rejected the answers, or nothing happened.
      if (!moved && state.clicks > 0 && !retrying) {
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
          else pending = clicked.settled.snapshot;
          continue;
        }

        // An account step: go on without an account, never sign in or create one.
        if (first.kind === PAGE_KIND.accountStep) {
          const target = pickOf(first);
          if (!first.guest || !target) {
            throw new RunStop(RUN_STAGE.applying, page, [
              "This step asks to sign in or create an account and offers no way to go on without one",
            ]);
          }
          state.clicks += 1;
          const label = target.picked.text || target.picked.label;
          enter(RUN_STAGE.applying, `Going on without an account · ${label}`);
          const clicked = await click(page, target.control, label);
          if (clicked.missed != null) missedClick(state, label, clicked.missed);
          else pending = clicked.settled.snapshot;
          continue;
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
      if (next.kind === PAGE_KIND.accountStep && !next.guest) {
        throw new RunStop(RUN_STAGE.advancing, page, [
          "This step asks to sign in or create an account and offers no way to go on without one",
        ]);
      }
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
      enter(
        RUN_STAGE.advancing,
        `${target.control.role === CONTROL_ROLE.submit ? "Submitting" : "Next step"} · ${label}`,
      );
      const clicked = await click(page, target.control, label);
      if (clicked.settled) {
        pending = clicked.settled.snapshot;
      } else if (clicked.disabled) {
        // The page holds its forward control until it has what it needs: answer what
        // is still blank or off, put back what it cleared, then click again.
        state.clicks -= 1;
        state.retryClick = true;
        if (state.blockedPasses >= RUN_MAX_BLOCKED_PASSES) {
          throw new RunStop(RUN_STAGE.advancing, page, [
            `"${label}" stayed disabled after ${state.blockedPasses} passes over what the page still needed`,
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
