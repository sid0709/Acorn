import { formatDuration, formatUsd } from "@acorn/shared/ai-usage";
import { FILL_MODE, type FillMode } from "@acorn/shared/field-issues";
import { applyApplicantIdentityToActions } from "@acorn/shared/plan-runner/applicant-identity";
import { runActionPlan } from "@acorn/shared/plan-runner/orchestrator";
import type { ActionPlan, PlanStepPayload, RunStepRecord } from "@acorn/shared/plan-runner/types";
import type { PipelineProgress } from "@acorn/shared/pipeline-types";
import { formatPlannerTree } from "@acorn/shared/planner-tree";
import { formatAnalyzeTrees } from "@acorn/shared/tree-export";
import { sendPlanStepToTab, sendTabMessage } from "../tab-messaging";
import { getTabJob } from "../tab-job-session";
import { customTabHasResume, getCustomTab } from "../tab-custom-session";
import { DEFAULT_ACORN_API_URL } from "../auth/acorn-auth";
import { MSG, type DomTreePayload, type PipelineSource } from "../types";
import { requestAiAnalyze } from "./api/analyze";
import { fetchRuntimeFile } from "./api/job-files";
import { keepResumeIfSameSite, loadFillResume } from "./fill-resume";
import { buildResumeUploadProgress } from "./resume-upload-status";
import {
  addPipelineUsage,
  beginPipelineUsageTracking,
  endPipelineUsageTracking,
} from "./usage-tracker";
import { decideChoicesInBatch } from "./choice-batch";
import { fetchDomFromTab } from "./fetch-dom";
import {
  REFILL_NOTHING_FLAGGED,
  REFILL_UNSUPPORTED,
  refillAnalyzingMessage,
  refillResultSuffix,
  rescanFieldIssues,
} from "./refill";
import { autoPauseDecision, countDomNodes, shortLabel } from "./run-pipeline-helpers";
import { traceFromBackground } from "../background/debug-trace-sink";
import { ACORN_DEBUG } from "../debug-trace";

export type PipelineEmit = (progress: PipelineProgress) => void;

export interface RunPipelineArgs {
  /** Pinned at Fill click. DOM fetch and every plan step target this tab, even if the user focuses another. */
  tabId: number;
  preferredFrameId?: number | null;
  aiServerUrl?: string;
  /** Worker Pool Fill (default) or Custom remembered-tab Fill. */
  source?: PipelineSource;
  /** Fill every field (default), or Refill only the fields the page flagged. */
  mode?: FillMode;
  /** Emit DOM tree to the backend (optional socket emit callback). */
  emitDomTree?: (payload: DomTreePayload) => void;
  /** Broadcast progress to the Chrome side panel + backend. */
  onProgress: PipelineEmit;
}

export async function runFabPipeline(args: RunPipelineArgs): Promise<void> {
  const {
    tabId,
    preferredFrameId = null,
    aiServerUrl = DEFAULT_ACORN_API_URL,
    source = "fill",
    mode = FILL_MODE.fill,
    emitDomTree,
    onProgress,
  } = args;

  const startedAt = Date.now();
  const refill = mode === FILL_MODE.refill;
  beginPipelineUsageTracking(tabId);

  let treeSnapshot: PipelineProgress["tree"];
  let planSnapshot: ActionPlan | undefined;
  let stepsSnapshot: RunStepRecord[] | undefined;

  const emit: PipelineEmit = (progress) => {
    if (progress.tree) treeSnapshot = progress.tree;
    if (progress.plan) planSnapshot = progress.plan;
    if (progress.steps) stepsSnapshot = progress.steps;
    onProgress(progress);
  };

  const finishMeta = () => {
    const durationMs = Date.now() - startedAt;
    const usage = endPipelineUsageTracking(tabId);
    return { durationMs, usage };
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
    const [fetchedDom, resumeLoad, runtimeFile] = await Promise.all([
      fetchDomFromTab(tabId, preferredFrameId, { fieldIssues: refill }),
      loadFillResume({
        source: resumeSource,
        tabJob,
        customTab,
        customGenerationId: customTab?.generationId ?? null,
        apiUrl: aiServerUrl,
      }),
      fetchRuntimeFile(aiServerUrl).catch(() => null),
    ]);
    // The page HTML only rides to Analyze's debug capture, not the socket or sidebar.
    const { html: pageHtml, fieldIssues, ...treePayload } = fetchedDom;
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

    if (refill && !fieldIssues?.issues.length) {
      const { durationMs, usage } = finishMeta();
      emit({
        phase: "done",
        message: REFILL_NOTHING_FLAGGED,
        durationMs,
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

    const analyze = await requestAiAnalyze(
      {
        pureTree,
        mode,
        fieldIssues: refill ? fieldIssues : undefined,
        page: {
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
        },
        debug: ACORN_DEBUG ? { html: pageHtml, domTree: treePayload.tree, metaTree } : undefined,
      },
      aiServerUrl,
      tabId,
    );
    addPipelineUsage(tabId, analyze.usage);
    if (refill && analyze.mode !== FILL_MODE.refill) {
      throw new Error(REFILL_UNSUPPORTED);
    }

    const plan = analyze.plan as ActionPlan;
    applyApplicantIdentityToActions(plan.actions);
    planSnapshot = plan;
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
      actions: (plan.actions ?? []).map((a, i) => ({
        i,
        action: a.action,
        element_index: a.element_index,
        label: a.expected_label,
        role: a.expected_role,
        value: a.value,
      })),
    }));

    const report = await runActionPlan({
      plan,
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
            matchedRole: typeof details.matchedRole === "string" ? details.matchedRole : undefined,
            valueAfter: typeof details.valueAfter === "string" ? details.valueAfter : undefined,
          },
        };
      },
      hooks: {
        beforeFills: () => decideChoicesInBatch({ tabId, frameId, plan, apiUrl: aiServerUrl }),
        onSteps: (steps) => {
          const running = steps.find((s) => s.status === "running" || s.status === "paused");
          const doneCount = steps.filter((s) =>
            ["ok", "skipped", "blocked", "failed", "aborted"].includes(s.status),
          ).length;
          const current = running ?? steps[Math.min(doneCount, steps.length - 1)];
          const idx = current ? current.index + 1 : doneCount;
          emit({
            phase: "running",
            message: `Running ${Math.min(idx, stepTotal)}/${stepTotal}…`,
            stepIndex: current?.index,
            stepTotal,
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
        onPause: async (request) => {
          emit({
            phase: "running",
            message:
              request.kind === "error"
                ? `Skipping: ${shortLabel(request.expected_label, request.action)}`
                : `Review: ${shortLabel(request.expected_label, request.action)}`,
            stepIndex: request.index,
            stepTotal,
            stepLabel: shortLabel(request.expected_label, request.action),
            resumeUpload: resumeUpload(),
          });
          return autoPauseDecision(request);
        },
      },
    });

    // Refill only touches the fields the page flagged.
    if (!report.aborted && !refill) {
      await sendTabMessage<{
        ok?: boolean;
        found?: number;
        filled?: number;
        raceLike?: number;
        error?: string;
        skipped?: boolean;
      }>(tabId, { type: MSG.FILL_LEFTOVER_COMBOS }, frameId ?? undefined, 120000);
    }

    const { durationMs, usage } = finishMeta();
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
      ? `Refilled ${okLabel}${refillResultSuffix(await rescanFieldIssues(tabId, frameId))}`
      : okLabel;

    emit({
      phase: "done",
      message: `Done · ${resultLabel} · ${timeLabel} · ${costLabel}`,
      stepTotal,
      durationMs,
      usage,
      tree: treeSnapshot,
      plan: planSnapshot,
      steps: report.steps,
      resumeUpload: doneResume,
    });
  } catch (err) {
    const { durationMs, usage } = finishMeta();
    const error = err instanceof Error ? err.message : String(err);
    emit({
      phase: "error",
      message: `Failed · ${formatDuration(durationMs)} · ${formatUsd(usage?.costUsd)}`,
      error,
      durationMs,
      usage,
      tree: treeSnapshot,
      plan: planSnapshot,
      steps: stepsSnapshot,
    });
  }
}
