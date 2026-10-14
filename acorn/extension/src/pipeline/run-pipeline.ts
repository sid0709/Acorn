import { formatDuration, formatUsd } from "@acorn/shared/ai-usage";
import { FILL_MODE, type FillMode } from "@acorn/shared/field-issues";
import { FAST_PLAN_MODE } from "@acorn/shared/form-fields";
import { PhaseClock } from "@acorn/shared/phase-clock";
import { applyApplicantIdentityToActions } from "@acorn/shared/plan-runner/applicant-identity";
import { planCodeFill, spreadCodeAcrossBoxes } from "@acorn/shared/plan-runner/code-fill";
import { runActionPlan } from "@acorn/shared/plan-runner/orchestrator";
import { isFileUploadAction, planWantsCoverLetter } from "@acorn/shared/plan-runner/step-file";
import { formatPlannerTree } from "@acorn/shared/planner-tree";
import { redactPlan } from "@acorn/shared/secret-value";
import { formatAnalyzeTrees } from "@acorn/shared/tree-export";

import { DEFAULT_ACORN_API_URL } from "../auth/acorn-auth";
import { traceFromBackground } from "../background/debug-trace-sink";
import { customTabHasResume, getCustomTab } from "../tab-custom-session";
import { getTabJob } from "../tab-job-session";
import { LOG_KIND, logTab } from "../tab-log-session";
import { sendPlanStepToTab, sendTabMessage } from "../tab-messaging";
import { MSG, type DomTreePayload, type PipelineSource } from "../types";

import { requestAiAnalyze } from "./api/analyze";
import { fetchRuntimeFile } from "./api/job-files";
import { decideChoicesInBatch } from "./choice-batch";
import { loadCoverLetter } from "./cover-letter";
import { repairDriftInTab } from "./drift";
import { fetchDomFromTab } from "./fetch-dom";
import { keepResumeIfSameSite, loadFillResume } from "./fill-resume";
import { watchFrameDocument } from "./frame-navigation";
import { lateFieldKey, planLateFields } from "./late-fields";
import { localIsoDate } from "./local-date";
import { requestPlan, wantsFastPlan } from "./plan-request";
import {
  REFILL_NOTHING_FLAGGED,
  REFILL_UNSUPPORTED,
  refillAnalyzingMessage,
  refillResultSuffix,
  rescanFieldIssues,
} from "./refill";
import { buildResumeUploadProgress } from "./resume-upload-status";
import { waitForPageSettled } from "./run-click";
import { autoPauseDecision, countDomNodes, mergeReports, shortLabel } from "./run-pipeline-helpers";
import { beginPipelineUsageTracking, endPipelineUsageTracking } from "./usage-tracker";

import type { PipelineProgress } from "@acorn/shared/pipeline-types";
import type { PlanTurn } from "@acorn/shared/plan-history";
import type {
  ActionPlan,
  PlanStepPayload,
  RunReport,
  RunStepRecord,
  RuntimeAttachedFile,
} from "@acorn/shared/plan-runner/types";

/** Run requires a résumé file; a fill that has none stops here, before any model call or step. */
export const NO_RESUME_FILE = "No résumé file to attach";

/** The leftover dropdown pass, all of its rounds, answers within this. */
const LEFTOVER_PASS_TIMEOUT_MS = 120_000;
/**
 * The page stops starting dropdowns this long before the pass's timeout, so the
 * one in hand can finish and the page is free again when the run moves on.
 */
const LEFTOVER_STOP_MARGIN_MS = 15_000;
/**
 * Times one fill starts over on a page the site replaced under it (an upload that
 * sends the form and draws the page again); past it the fill fails.
 */
const FILL_MAX_PAGE_RELOADS = 3;
/**
 * Looks for fields drawn after the plan ran, each planning only new ones. The
 * page settles within a few: the bound only stops a page that keeps adding fields.
 */
const LATE_PASSES_MAX = 3;
/** What the fill says while the site loads the page it sent away. */
const PAGE_RELOADING = "The page reloaded while Acorn filled it; filling it again once it loads…";

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
  /**
   * Run, after a click opened something inside the page (an entry form the page
   * asks for, a dialog): fill only its fields. The rest of the page was filled
   * already and is not planned again.
   */
  scoped?: boolean;
  /**
   * Refill: read the page's errors again at the end, for the "still flagged" count.
   * Run reads the page itself right after, so it turns this off.
   */
  rescan?: boolean;
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
    scoped = false,
    rescan = true,
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
    // What each read asks the page for: the compact tree, plus the fields a plan
    // reads (a refill lists only those the page flags). The page's HTML never leaves it.
    const readOptions = {
      fieldIssues: refill,
      formFields: wantsFastPlan(mode) || refill,
      flaggedFields: refill,
      scopeFields: scoped,
    };
    // The files a fill attaches load while the page is read. A refill attaches one
    // only when its plan uploads one, so it does not wait for them before planning.
    const loadFiles = () =>
      Promise.all([
        clock.time("resume", () =>
          loadFillResume({
            source: resumeSource,
            tabJob,
            customTab,
            customGenerationId: customTab?.generationId ?? null,
            apiUrl: aiServerUrl,
          }),
        ),
        clock.time("runtime", () => fetchRuntimeFile(aiServerUrl).catch(() => null)),
      ]);
    let filesLoad = refill ? null : loadFiles();
    // Awaited right after the read; a read that fails first must not leave it unhandled.
    filesLoad?.catch(() => undefined);
    const fetchedDom = await clock.time("dom", () =>
      fetchDomFromTab(tabId, preferredFrameId, readOptions),
    );
    let [resumeLoad, runtimeFile]: Awaited<ReturnType<typeof loadFiles>> = filesLoad
      ? await filesLoad
      : [{ file: null, skipReason: null }, null];
    let { fieldIssues, formFields, timings, ...treePayload } = fetchedDom;
    const usingLibrary = resumeSource === "custom" && customTab?.resumeMode === "recommend";
    const resumeFileKind = resumeSource === "custom" && !usingLibrary ? "custom" : "library";
    /** The résumé this fill attaches, from what was loaded, and how the sidebar names it. */
    const bindResume = (load: typeof resumeLoad) => {
      const bound =
        resumeSource === "custom"
          ? { file: load.file, skipReason: load.skipReason }
          : keepResumeIfSameSite(load.file, tabJob, treePayload.url, load.skipReason);
      return {
        file: bound.file,
        recommended: resumeSource === "custom" ? (usingLibrary ? bound.file : null) : bound.file,
        custom: resumeSource === "custom" && !usingLibrary ? bound.file : null,
        skipReason: bound.skipReason,
        stack:
          resumeSource === "custom"
            ? bound.file?.label ||
              (usingLibrary
                ? customTab?.recommendedResumeStack
                : customTab?.generationId
                  ? "Generated"
                  : null)
            : (tabJob?.resumeStack ?? null),
      };
    };
    let resume = bindResume(resumeLoad);
    emitDomTree?.(treePayload);
    logTab(tabId, LOG_KIND.dom, `DOM tree · ${treePayload.title || "Untitled"}`, () => ({
      url: treePayload.url,
      title: treePayload.title,
      fetchedAt: treePayload.fetchedAt,
      frameId: treePayload.frameId ?? null,
      nodes: countDomNodes(treePayload.tree),
      treeJsonChars: JSON.stringify(treePayload.tree).length,
      timings,
    }));
    traceFromBackground("dom:read", () => ({ refill, timings }), tabId);
    treeSnapshot = {
      url: treePayload.url,
      title: treePayload.title,
      tree: treePayload.tree,
      fetchedAt: treePayload.fetchedAt,
    };

    const resumeUpload = (steps = stepsSnapshot) =>
      buildResumeUploadProgress({
        recommendedResume: resume.file,
        resumeStack: resume.stack,
        skipReason: resume.skipReason,
        steps,
      });

    if (requireResume && !refill && !resume.file) {
      const { durationMs, usage, phases } = await finishMeta();
      emit({
        phase: "error",
        message: NO_RESUME_FILE,
        error: resume.skipReason ? `${NO_RESUME_FILE}: ${resume.skipReason}` : NO_RESUME_FILE,
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

    // A cover letter is chosen only when the plan uploads one, once per fill.
    let coverLetterLoad: Promise<RuntimeAttachedFile | null> | null = null;
    let report: RunReport;
    let stepTotal = 0;
    let frameId: number | null = null;
    // One pass reads the page, plans it, and fills it. A site that replaces the page
    // under the fill (an upload that sends the form and draws it again) gets a new
    // pass on the page it drew: nothing is written into a page that is going away.
    for (let reloads = 0; ; reloads += 1) {
      const nodeCount = countDomNodes(treePayload.tree);
      emit({
        phase: "analyzing",
        message:
          refill && fieldIssues
            ? refillAnalyzingMessage(fieldIssues)
            : resume.file
              ? `Analyzing ${nodeCount} nodes · resume ${resume.file.label || resume.file.name}`
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
      // The meta tree is for the Logs panel only: built when the log is written.
      const tree = treePayload.tree;
      logTab(
        tabId,
        LOG_KIND.pureTree,
        `Compressed tree · ${pureTree.length} characters`,
        () => pureTree,
      );
      logTab(
        tabId,
        LOG_KIND.metaTree,
        `Meta tree · ${nodeCount} nodes`,
        () => formatAnalyzeTrees(tree).metaTree,
      );
      logTab(tabId, LOG_KIND.analysis, `Analysis · ${formFields?.length ?? 0} fields`, () => ({
        mode,
        nodes: nodeCount,
        formFields,
        fieldIssues,
      }));

      const page = {
        title: treePayload.title || "Untitled",
        url: treePayload.url,
        fetchedAt: treePayload.fetchedAt,
        // The applicant's own date: a date-of-signing field takes today as they see it.
        today: localIsoDate(),
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
        recommendedResumeAvailable: Boolean(resume.file),
        recommendedResumeStack:
          resume.file?.label ||
          (source === "custom"
            ? usingLibrary
              ? customTab?.recommendedResumeStack
              : customTab?.generationId
                ? "Generated"
                : null
            : tabJob?.resumeStack) ||
          null,
      };

      // An emailed code is typed from the page's own boxes: no planner call.
      const codeActions =
        verificationCode && !refill && formFields
          ? planCodeFill(formFields, verificationCode)
          : null;
      const planRequest = {
        pureTree,
        mode,
        fieldIssues: refill ? fieldIssues : undefined,
        // A refill's flagged fields are planned on their own first; the conversation
        // (tree and history) plans the fixes only when they leave one open.
        formFields: refill ? formFields : undefined,
        history: refill && history?.length ? history : undefined,
        page,
        verificationCode,
      };
      // What a click opened is planned from its own fields alone: the full planner
      // reads the whole page and would plan the rest of it over again. A refill of
      // it is a refill like any other, of the fields the page flags in it.
      const scopedFill = scoped && !refill;
      const analyze =
        pendingOnly || (scopedFill && !formFields?.length)
          ? { mode: FAST_PLAN_MODE, plan: emptyPlan() }
          : codeActions
            ? { mode: FAST_PLAN_MODE, plan: { ...emptyPlan(), actions: codeActions } }
            : await clock.time("plan", () =>
                scopedFill
                  ? requestAiAnalyze(
                      { ...planRequest, mode: FAST_PLAN_MODE, formFields },
                      aiServerUrl,
                      tabId,
                    )
                  : requestPlan(planRequest, formFields, aiServerUrl, tabId),
              );
      if (refill && analyze.mode !== FILL_MODE.refill) {
        throw new Error(REFILL_UNSUPPORTED);
      }
      if (refill) {
        traceFromBackground(
          "refill:planner",
          () => ({
            planner: "refillPlanner" in analyze ? (analyze.refillPlanner ?? null) : null,
            flaggedFields: formFields?.length ?? 0,
          }),
          tabId,
        );
      }

      const plan = analyze.plan as ActionPlan;
      applyApplicantIdentityToActions(plan.actions);
      spreadCodeAcrossBoxes(plan.actions, verificationCode);
      planSnapshot = redactPlan(plan);
      // What the planner sent, for logs written later: the steps' values are rewritten next.
      const shownPlan: ActionPlan = {
        ...planSnapshot,
        actions: (planSnapshot.actions ?? []).map((action) => ({ ...action })),
      };
      stepTotal = plan.actions?.length ?? 0;

      emit({
        phase: "running",
        message: stepTotal ? `Running 0/${stepTotal}…` : "Running…",
        stepIndex: 0,
        stepTotal,
        plan,
        resumeUpload: resumeUpload(),
      });

      frameId = treePayload.frameId ?? preferredFrameId ?? null;
      logTab(tabId, LOG_KIND.plan, `Action plan · ${stepTotal} actions`, () => shownPlan);
      traceFromBackground(
        "plan",
        () => ({
          frameId,
          actions: (shownPlan.actions ?? []).map((a, i) => ({
            i,
            action: a.action,
            element_index: a.element_index,
            label: a.expected_label,
            role: a.expected_role,
            value: a.value,
          })),
        }),
        tabId,
      );

      const coverLetterFor = (target: ActionPlan) => {
        if (!planWantsCoverLetter(target.actions)) return Promise.resolve(null);
        coverLetterLoad ??= clock
          .time("cover-letter", () =>
            loadCoverLetter({
              tabId,
              customTab,
              tabJob,
              pageText: pureTree,
              apiUrl: aiServerUrl,
            }),
          )
          .catch((err) => {
            traceFromBackground("cover-letter:failed", () => ({ error: String(err) }), tabId);
            return null;
          });
        return coverLetterLoad;
      };

      const watch = await watchFrameDocument(tabId, frameId);
      try {
        const runPlan = async (target: ActionPlan, total: number) => {
          const coverLetter = await coverLetterFor(target);
          // A refill that uploads (a résumé the page refused) loads its files only now.
          if (!filesLoad && (target.actions ?? []).some(isFileUploadAction)) {
            filesLoad = loadFiles();
            [resumeLoad, runtimeFile] = await filesLoad;
            resume = bindResume(resumeLoad);
          }
          return clock.time("steps", () =>
            runActionPlan({
              plan: target,
              runtimeFile,
              recommendedResume: resume.recommended,
              customResume: resume.custom,
              resumeFileKind,
              coverLetter,
              force: refill,
              executeStep: async (step: PlanStepPayload) => {
                const sentAt = Date.now();
                const res = await sendPlanStepToTab(tabId, step, frameId);
                traceFromBackground(
                  "step:result",
                  () => ({
                    element_index: step.element_index,
                    label: step.expected_label,
                    ok: res.ok,
                    alreadyFilled: res.alreadyFilled,
                    error: res.error,
                    valueAfter: res.details?.valueAfter,
                    ms: Date.now() - sentAt,
                  }),
                  tabId,
                );
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
                    valueAfter:
                      typeof details.valueAfter === "string" ? details.valueAfter : undefined,
                  },
                };
              },
              hooks: {
                // A page on its way out takes no more steps: the next pass fills the new one.
                shouldAbort: () => signal?.aborted === true || watch.left(),
                beforeFills: () =>
                  decideChoicesInBatch({ tabId, frameId, plan: target, apiUrl: aiServerUrl }),
                onSteps: (steps) => {
                  const running = steps.find(
                    (s) => s.status === "running" || s.status === "paused",
                  );
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
                    stepLabel: current
                      ? shortLabel(current.expected_label, current.action)
                      : undefined,
                    steps,
                    resumeUpload: resumeUpload(steps),
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
        };

        report = await runPlan(plan, stepTotal);

        // Fields the first scan could not see: a section that rendered late, fields an
        // import re-rendered, follow-ups an answer revealed. The page is looked at
        // again until a look finds nothing new, however long it took to draw.
        // Questions the plan answered are done; one it left is looked at once more.
        const lateSeen = new Set<string>(
          (plan.actions ?? []).map((action) => lateFieldKey(action.expected_label)).filter(Boolean),
        );
        const settleLate = async () => {
          for (let pass = 0; pass < LATE_PASSES_MAX && !report.aborted; pass += 1) {
            const late = await clock.time("late", () =>
              planLateFields({
                tabId,
                frameId,
                page,
                apiUrl: aiServerUrl,
                blocked: pendingOnly,
                seen: lateSeen,
                scoped,
              }),
            );
            if (!late) return;
            planSnapshot = redactPlan({
              ...plan,
              actions: [...(planSnapshot?.actions ?? plan.actions ?? []), ...late.actions],
            });
            report = mergeReports(report, await runPlan(late, late.actions.length));
          }
        };
        // A refill's answers reveal questions too (a "which platform?" after "Social
        // Media"): it looks again like any other pass, though it plans no field it fixed.
        const looksLate = pendingOnly || wantsFastPlan(mode) || refill;
        if (looksLate) await settleLate();

        // A page that rewrote itself under the fill (a résumé import, a reset) gets its
        // answers back before the leftover pass reads what is still empty.
        if (!report.aborted) {
          const drift = await clock.time("drift", () =>
            repairDriftInTab(tabId, frameId, startedAt),
          );
          traceFromBackground("drift:repair", () => drift, tabId);
        }

        // The dropdowns no step answered. A refill touches only the blank ones the page
        // asks for: a custom dropdown is in no field list, so this pass answers it, as
        // in a first fill.
        if (!report.aborted) {
          const leftover = await clock.time("leftover", () =>
            sendTabMessage<{
              ok?: boolean;
              found?: number;
              filled?: number;
              error?: string;
              skipped?: boolean;
            }>(
              tabId,
              {
                type: MSG.FILL_LEFTOVER_COMBOS,
                // A pass the run stopped waiting for must not hold the page: its next
                // steps (a fill, the Submit click) queue behind it.
                deadline: Date.now() + LEFTOVER_PASS_TIMEOUT_MS - LEFTOVER_STOP_MARGIN_MS,
                scoped,
                flagged: refill,
              },
              frameId ?? undefined,
              LEFTOVER_PASS_TIMEOUT_MS,
            ),
          );
          // A dropdown answer can draw new fields (an address block after a country).
          if (looksLate && (!refill || (leftover?.filled ?? 0) > 0)) await settleLate();
        }

        if (!watch.left() || signal?.aborted) break;
        if (reloads >= FILL_MAX_PAGE_RELOADS) {
          throw new Error(`The page reloaded ${reloads + 1} times while Acorn filled it`);
        }
        traceFromBackground("fill:page-replaced", () => ({ pass: reloads + 1, frameId }), tabId);
        emit({ phase: "fetching", message: PAGE_RELOADING, mode });
        await watch.arrived();
      } finally {
        watch.stop();
      }
      await waitForPageSettled(tabId, frameId ?? undefined);
      ({ fieldIssues, formFields, timings, ...treePayload } = await clock.time("dom", () =>
        fetchDomFromTab(tabId, frameId, readOptions),
      ));
      traceFromBackground("dom:read", () => ({ refill, timings, reread: true }), tabId);
      emitDomTree?.(treePayload);
      treeSnapshot = {
        url: treePayload.url,
        title: treePayload.title,
        tree: treePayload.tree,
        fetchedAt: treePayload.fetchedAt,
      };
    }

    const { durationMs, usage } = await finishMeta();
    const timeLabel = formatDuration(durationMs);
    const costLabel = formatUsd(usage?.costUsd);

    const doneResume = resumeUpload(report.steps);

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
    const stillFlagged =
      refill && rescan
        ? refillResultSuffix(await clock.time("rescan", () => rescanFieldIssues(tabId, frameId)))
        : "";
    const resultLabel = refill ? `Refilled ${okLabel}${stillFlagged}` : okLabel;

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
