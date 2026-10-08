import { formatDuration, formatUsd } from "@acorn/shared/ai-usage";
import { FILL_MODE, type FillMode } from "@acorn/shared/field-issues";
import { FAST_PLAN_MODE } from "@acorn/shared/form-fields";
import { PhaseClock } from "@acorn/shared/phase-clock";
import { applyApplicantIdentityToActions } from "@acorn/shared/plan-runner/applicant-identity";
import { runActionPlan } from "@acorn/shared/plan-runner/orchestrator";
import { formatPlannerTree } from "@acorn/shared/planner-tree";
import { redactPlan } from "@acorn/shared/secret-value";
import { formatAnalyzeTrees } from "@acorn/shared/tree-export";

import { DEFAULT_ACORN_API_URL } from "../auth/acorn-auth";
import { traceFromBackground } from "../background/debug-trace-sink";
import { ACORN_DEBUG } from "../debug-trace";
import { customTabHasResume, getCustomTab } from "../tab-custom-session";
import { getTabJob } from "../tab-job-session";
import { sendPlanStepToTab, sendTabMessage } from "../tab-messaging";
import { MSG, type DomTreePayload, type PipelineSource } from "../types";

import { fetchRuntimeFile } from "./api/job-files";
import { decideChoicesInBatch } from "./choice-batch";
import { repairDriftInTab } from "./drift";
import { fetchDomFromTab } from "./fetch-dom";
import { keepResumeIfSameSite, loadFillResume } from "./fill-resume";
import { planLateFields } from "./late-fields";
import { requestPlan, wantsFastPlan } from "./plan-request";
import {
  REFILL_NOTHING_FLAGGED,
  REFILL_UNSUPPORTED,
  refillAnalyzingMessage,
  refillResultSuffix,
  rescanFieldIssues,
} from "./refill";
import { buildResumeUploadProgress } from "./resume-upload-status";
import { autoPauseDecision, countDomNodes, mergeReports, shortLabel } from "./run-pipeline-helpers";
import { beginPipelineUsageTracking, endPipelineUsageTracking } from "./usage-tracker";

import type { PipelineProgress } from "@acorn/shared/pipeline-types";
import type { PlanTurn } from "@acorn/shared/plan-history";
import type { ActionPlan, PlanStepPayload, RunStepRecord } from "@acorn/shared/plan-runner/types";

/** Run requires a résumé file; a fill that has none stops here, before any model call or step. */
export const NO_RESUME_FILE = "No résumé file to attach";

/** The leftover dropdown pass, all of its rounds, answers within this. */
const LEFTOVER_PASS_TIMEOUT_MS = 120_000;

export type PipelineEmit = (progress: PipelineProgress) => void;

/** A plan with no steps: the start of a pass that only plans what is still pending. */
function emptyPlan(): ActionPlan {
  return {
    goal: "Answer what the page still needs",
    actions: [],
    forbidden_actions: [],
    validation: { required_element_indexes: [], stop_before_submit: true },
    unresolved_items: [],
  };
}

export interface RunPipelineArgs {
  /** Pinned at Fill click. DOM fetch and every plan step target this tab, even if the user focuses another. */
  tabId: number;
  preferredFrameId?: number | null;
  aiServerUrl?: string;
  /** Worker Pool Fill (default) or Custom remembered-tab Fill. */
  source?: PipelineSource;
  /** Fill every field (default), or Refill only the fields the page flagged. */
  mode?: FillMode;
  /** Refill: the plans already run on this page and what came of them, oldest first. */
  history?: PlanTurn[];
  /** Run: a fill with no résumé file stops before touching the page. Fill page leaves it off. */
  requireResume?: boolean;
  /** Run: a code found in the applicant's mail, filled into the field that asks for it. */
  verificationCode?: string;
  /** Run: aborted when the person stops the run; no further step touches the page. */
  signal?: AbortSignal;
  /**
   * Run, when the page holds its forward control disabled after a fill: plan only
   * what is still unanswered (boxes left off included), then put back anything
   * the page cleared. No full plan, so nothing already answered is rewritten.
   */
  pendingOnly?: boolean;
  /** Emit DOM tree to the backend (optional socket emit callback). */
  emitDomTree?: (payload: DomTreePayload) => void;
  /** Broadcast progress to the Chrome side panel + backend. */
  onProgress: PipelineEmit;
}

// eslint-disable-next-line complexity -- coordinates analyze, plan, and fill for one tab
export async function runFabPipeline(args: RunPipelineArgs): Promise<void> {
  const {
    tabId,
    preferredFrameId = null,
    aiServerUrl = DEFAULT_ACORN_API_URL,
    source = "fill",
    mode = FILL_MODE.fill,
    history,
    requireResume = false,
    pendingOnly = false,
    verificationCode,
    signal,
    emitDomTree,
    onProgress,
  } = args;

  const startedAt = Date.now();
  const clock = new PhaseClock();
  const refill = mode === FILL_MODE.refill;
  beginPipelineUsageTracking(tabId);

  let treeSnapshot: PipelineProgress["tree"];
  let planSnapshot: ActionPlan | undefined;
  let stepsSnapshot: RunStepRecord[] | undefined;

  // Progress reaches the sidebar and the backend: a plan in it never carries a password.
  const emit: PipelineEmit = (progress) => {
    if (progress.plan) progress = { ...progress, plan: redactPlan(progress.plan) };
    if (progress.tree) treeSnapshot = progress.tree;
    if (progress.plan) planSnapshot = progress.plan;
    if (progress.steps) stepsSnapshot = progress.steps;
    onProgress(progress);
  };

  const finishMeta = async () => {
    const durationMs = Date.now() - startedAt;
    const usage = await endPipelineUsageTracking(tabId);
    return { durationMs, usage, phases: clock.summary() };
  };

  try {
    emit({ phase: "fetching", message: "Fetching DOM…", mode });

    const customTab = await getCustomTab(tabId);
    if (source === "custom" && !customTab) {
      throw new Error("Remember this tab before Fill");
    }
    const tabJob = source === "custom" ? null : await getTabJob(tabId);
    const usingForcedCustom =
      source !== "custom" && customTab != null && customTabHasResume(customTab);
    const resumeSource: PipelineSource =
      source === "custom" || usingForcedCustom ? "custom" : "fill";
    const [fetchedDom, resumeLoad, runtimeFile] = await clock.time("dom", () =>
      Promise.all([
        fetchDomFromTab(tabId, preferredFrameId, {
          fieldIssues: refill,
          formFields: wantsFastPlan(mode),
        }),
        loadFillResume({
          source: resumeSource,
          tabJob,
          customTab,
          customGenerationId: customTab?.generationId ?? null,
          apiUrl: aiServerUrl,
        }),
        fetchRuntimeFile(aiServerUrl).catch(() => null),
      ]),
    );
    // The page HTML only rides to Analyze's debug capture, not the socket or sidebar.
    const { html: pageHtml, fieldIssues, formFields, ...treePayload } = fetchedDom;
    const boundResume =
      resumeSource === "custom"
        ? { file: resumeLoad.file, skipReason: resumeLoad.skipReason }
        : keepResumeIfSameSite(resumeLoad.file, tabJob, treePayload.url, resumeLoad.skipReason);
    const resumeFile = boundResume.file;
    const usingLibrary = resumeSource === "custom" && customTab?.resumeMode === "recommend";
    const recommendedResume =
      resumeSource === "custom" ? (usingLibrary ? resumeFile : null) : resumeFile;
    const customResume = resumeSource === "custom" && !usingLibrary ? resumeFile : null;
    const resumeFileKind = resumeSource === "custom" && !usingLibrary ? "custom" : "library";
    const resumeSkipReason = boundResume.skipReason;
    const boundResumeStack =
      resumeSource === "custom"
        ? resumeFile?.label ||
          (usingLibrary
            ? customTab?.recommendedResumeStack
            : customTab?.generationId
              ? "Generated"
              : null)
        : (tabJob?.resumeStack ?? null);
    emitDomTree?.(treePayload);
    treeSnapshot = {
      url: treePayload.url,
      title: treePayload.title,
      tree: treePayload.tree,
      fetchedAt: treePayload.fetchedAt,
    };

    const resumeUpload = () =>
      buildResumeUploadProgress({
        recommendedResume: resumeFile,
        resumeStack: boundResumeStack,
        skipReason: resumeSkipReason,
        steps: stepsSnapshot,
      });

    if (requireResume && !refill && !resumeFile) {
      const { durationMs, usage, phases } = await finishMeta();
      emit({
        phase: "error",
        message: NO_RESUME_FILE,
        error: resumeSkipReason ? `${NO_RESUME_FILE}: ${resumeSkipReason}` : NO_RESUME_FILE,
        durationMs,
        phases,
        usage,
        tree: treeSnapshot,
        resumeUpload: resumeUpload(),
      });
      return;
    }

    if (refill && !fieldIssues?.issues.length) {
      const { durationMs, usage, phases } = await finishMeta();
      emit({
        phase: "done",
        message: REFILL_NOTHING_FLAGGED,
        durationMs,
        phases,
        usage,
        tree: treeSnapshot,
        resumeUpload: resumeUpload(),
      });
      return;
    }

    const nodeCount = countDomNodes(treePayload.tree);
    emit({
      phase: "analyzing",
      message:
        refill && fieldIssues
          ? refillAnalyzingMessage(fieldIssues)
          : resumeFile
            ? `Analyzing ${nodeCount} nodes · resume ${resumeFile.label || resumeFile.name}`
            : source === "custom"
              ? usingLibrary && customTab?.recommendedResumeId
                ? `Analyzing ${nodeCount} nodes · Library file unavailable`
                : customTab?.generationId
                  ? `Analyzing ${nodeCount} nodes · generated file unavailable`
                  : `Analyzing ${nodeCount} nodes…`
              : tabJob?.resumeStack
                ? `Analyzing ${nodeCount} nodes · ${tabJob.resumeStack} file unavailable`
                : `Analyzing ${nodeCount} nodes…`,
      tree: treeSnapshot,
      resumeUpload: resumeUpload(),
    });

    // The planner reads the compact tree; the full Meta Tree only rides to debug capture.
    const pureTree = formatPlannerTree(treePayload.tree);
    const metaTree = ACORN_DEBUG ? formatAnalyzeTrees(treePayload.tree).metaTree : undefined;

    const page = {
      title: treePayload.title || "Untitled",
      url: treePayload.url,
      fetchedAt: treePayload.fetchedAt,
      job:
        source === "custom"
          ? null
          : tabJob
            ? {
                id: tabJob.jobId,
                title: tabJob.title,
                company: tabJob.company,
              }
            : null,
      customGenerationId:
        source === "custom" && !usingLibrary ? (customTab?.generationId ?? null) : null,
      customLibraryResumeId:
        source === "custom" && usingLibrary ? (customTab?.recommendedResumeId ?? null) : null,
      customRemembered: source === "custom",
      recommendedResumeAvailable: Boolean(resumeFile),
      recommendedResumeStack:
        resumeFile?.label ||
        (source === "custom"
          ? usingLibrary
            ? customTab?.recommendedResumeStack
            : customTab?.generationId
              ? "Generated"
              : null
          : tabJob?.resumeStack) ||
        null,
    };

    const analyze = pendingOnly
      ? { mode: FAST_PLAN_MODE, plan: emptyPlan() }
      : await clock.time("plan", () =>
          requestPlan(
            {
              pureTree,
              mode,
              fieldIssues: refill ? fieldIssues : undefined,
              history: refill && history?.length ? history : undefined,
              page,
              verificationCode,
              debug: ACORN_DEBUG
                ? { html: pageHtml, domTree: treePayload.tree, metaTree }
                : undefined,
            },
            formFields,
            aiServerUrl,
            tabId,
          ),
        );
    if (refill && analyze.mode !== FILL_MODE.refill) {
      throw new Error(REFILL_UNSUPPORTED);
    }

    const plan = analyze.plan as ActionPlan;
    applyApplicantIdentityToActions(plan.actions);
    planSnapshot = redactPlan(plan);
    const stepTotal = plan.actions?.length ?? 0;

    emit({
      phase: "running",
      message: stepTotal ? `Running 0/${stepTotal}…` : "Running…",
      stepIndex: 0,
      stepTotal,
      plan,
      resumeUpload: resumeUpload(),
    });

    const frameId = treePayload.frameId ?? preferredFrameId ?? null;
    traceFromBackground("plan", () => ({
      frameId,
      actions: (redactPlan(plan).actions ?? []).map((a, i) => ({
        i,
        action: a.action,
        element_index: a.element_index,
        label: a.expected_label,
        role: a.expected_role,
        value: a.value,
      })),
    }));

    const runPlan = (target: ActionPlan, total: number) =>
      clock.time("steps", () =>
        runActionPlan({
          plan: target,
          runtimeFile,
          recommendedResume,
          customResume,
          resumeFileKind,
          force: refill,
          executeStep: async (step: PlanStepPayload) => {
            const sentAt = Date.now();
            const res = await sendPlanStepToTab(tabId, step, frameId);
            traceFromBackground("step:result", () => ({
              element_index: step.element_index,
              label: step.expected_label,
              ok: res.ok,
              alreadyFilled: res.alreadyFilled,
              error: res.error,
              valueAfter: res.details?.valueAfter,
              ms: Date.now() - sentAt,
            }));
            const details = res.details ?? {};
            return {
              ok: Boolean(res.ok),
              verified: res.verified,
              acted: res.acted,
              alreadyFilled: Boolean(res.alreadyFilled),
              error: res.error,
              details: {
                nodeId: typeof details.nodeId === "number" ? details.nodeId : undefined,
                matchedLabel:
                  typeof details.matchedLabel === "string" ? details.matchedLabel : undefined,
                matchedRole:
                  typeof details.matchedRole === "string" ? details.matchedRole : undefined,
                valueAfter: typeof details.valueAfter === "string" ? details.valueAfter : undefined,
              },
            };
          },
          hooks: {
            shouldAbort: () => signal?.aborted === true,
            beforeFills: () =>
              decideChoicesInBatch({ tabId, frameId, plan: target, apiUrl: aiServerUrl }),
            onSteps: (steps) => {
              const running = steps.find((s) => s.status === "running" || s.status === "paused");
              const doneCount = steps.filter((s) =>
                ["ok", "skipped", "blocked", "failed", "aborted"].includes(s.status),
              ).length;
              const current = running ?? steps[Math.min(doneCount, steps.length - 1)];
              const idx = current ? current.index + 1 : doneCount;
              emit({
                phase: "running",
                message: `Running ${Math.min(idx, total)}/${total}…`,
                stepIndex: current?.index,
                stepTotal: total,
                stepLabel: current ? shortLabel(current.expected_label, current.action) : undefined,
                steps,
                resumeUpload: buildResumeUploadProgress({
                  recommendedResume: resumeFile,
                  resumeStack: boundResumeStack,
                  skipReason: resumeSkipReason,
                  steps,
                }),
              });
            },
            onPause: (request) => {
              emit({
                phase: "running",
                message:
                  request.kind === "error"
                    ? `Skipping: ${shortLabel(request.expected_label, request.action)}`
                    : `Review: ${shortLabel(request.expected_label, request.action)}`,
                stepIndex: request.index,
                stepTotal: total,
                stepLabel: shortLabel(request.expected_label, request.action),
                resumeUpload: resumeUpload(),
              });
              return autoPauseDecision(request);
            },
          },
        }),
      );

    let report = await runPlan(plan, stepTotal);

    // Fields the first scan could not see: a section that rendered late, fields an
    // import re-rendered, follow-ups an answer revealed.
    const late =
      !report.aborted && (pendingOnly || wantsFastPlan(mode))
        ? await clock.time("late", () =>
            planLateFields({ tabId, frameId, page, apiUrl: aiServerUrl, blocked: pendingOnly }),
          )
        : null;
    if (late) {
      planSnapshot = redactPlan({ ...plan, actions: [...(plan.actions ?? []), ...late.actions] });
      report = mergeReports(report, await runPlan(late, late.actions.length));
    }

    // A page that rewrote itself under the fill (a résumé import, a reset) gets its
    // answers back before the leftover pass reads what is still empty.
    if (!report.aborted) {
      const drift = await clock.time("drift", () => repairDriftInTab(tabId, frameId, startedAt));
      traceFromBackground("drift:repair", () => drift);
    }

    // Refill only touches the fields the page flagged.
    if (!report.aborted && !refill) {
      await clock.time("leftover", () =>
        sendTabMessage<{
          ok?: boolean;
          found?: number;
          filled?: number;
          error?: string;
          skipped?: boolean;
        }>(
          tabId,
          { type: MSG.FILL_LEFTOVER_COMBOS },
          frameId ?? undefined,
          LEFTOVER_PASS_TIMEOUT_MS,
        ),
      );
    }

    const { durationMs, usage } = await finishMeta();
    const timeLabel = formatDuration(durationMs);
    const costLabel = formatUsd(usage?.costUsd);

    const doneResume = buildResumeUploadProgress({
      recommendedResume: resumeFile,
      resumeStack: boundResumeStack,
      skipReason: resumeSkipReason,
      steps: report.steps,
    });

    if (report.aborted) {
      emit({
        phase: "error",
        message: `Aborted · ${timeLabel} · ${costLabel}`,
        error: "Plan run aborted",
        stepTotal,
        durationMs,
        phases: clock.summary(),
        usage,
        tree: treeSnapshot,
        plan: planSnapshot,
        steps: report.steps,
        resumeUpload: doneResume,
      });
      return;
    }

    const { summary } = report;
    const okLabel = report.ok ? `${summary.ok} ok` : `${summary.ok} ok, ${summary.skipped} skipped`;
    const resultLabel = refill
      ? `Refilled ${okLabel}${refillResultSuffix(
          await clock.time("rescan", () => rescanFieldIssues(tabId, frameId)),
        )}`
      : okLabel;

    emit({
      phase: "done",
      message: `Done · ${resultLabel} · ${timeLabel} · ${costLabel}`,
      stepTotal,
      durationMs,
      phases: clock.summary(),
      usage,
      tree: treeSnapshot,
      plan: planSnapshot,
      steps: report.steps,
      resumeUpload: doneResume,
    });
  } catch (err) {
    const { durationMs, usage } = await finishMeta();
    const error = err instanceof Error ? err.message : String(err);
    emit({
      phase: "error",
      message: `Failed · ${formatDuration(durationMs)} · ${formatUsd(usage?.costUsd)}`,
      error,
      durationMs,
      phases: clock.summary(),
      usage,
      tree: treeSnapshot,
      plan: planSnapshot,
      steps: stepsSnapshot,
    });
  }
}
