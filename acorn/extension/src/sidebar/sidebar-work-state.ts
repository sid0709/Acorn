import { FILL_MODE } from "@acorn/shared/field-issues";
import { canContinueGenerate } from "@acorn/shared/generate-checkpoint";
import { isFillPhaseBusy, type PipelineProgress } from "@acorn/shared/pipeline-types";
import type { AcornMainTab } from "./SidebarNav";
import type { useTabSession } from "./use-tab-session";

type TabSession = ReturnType<typeof useTabSession>;

export const RUN_HINT =
  "Recommend a résumé, fill each page, and click Next or Submit until the application is done.";

export const REFILL_HINT = "Fix the fields this page flagged. Click Submit or Next first.";

/** Whether the active tab's Custom tab or attached Fill job has Generate / Recommend in flight. */
export function isGenerateBusy(
  customTab: TabSession["customTab"],
  tabJob: TabSession["tabJob"],
  jobGenerates: TabSession["jobGenerates"],
): boolean {
  return (
    customTab?.generateStatus === "queued" ||
    customTab?.generateStatus === "running" ||
    (tabJob != null &&
      (jobGenerates[tabJob.jobId]?.generateStatus === "queued" ||
        jobGenerates[tabJob.jobId]?.generateStatus === "running"))
  );
}

/** Whether any tab is filling, generating, or recommending. */
export function isAnyTabWorking(
  pipelines: TabSession["pipelines"],
  customList: TabSession["customList"],
  jobGenerates: TabSession["jobGenerates"],
): boolean {
  return (
    Object.values(pipelines).some((row) => isFillPhaseBusy(row.phase)) ||
    customList.some((tab) => tab.generateStatus === "queued" || tab.generateStatus === "running") ||
    Object.values(jobGenerates).some(
      (row) => row.generateStatus === "queued" || row.generateStatus === "running",
    )
  );
}

/** Labels and Continue state for the sticky Generate / Fill page / Recommend bar. */
export function actionBarState({
  mainTab,
  tabJob,
  customTab,
  jobGenerates,
  progress,
  fillBusy,
  generateBusy,
}: {
  mainTab: AcornMainTab;
  tabJob: TabSession["tabJob"];
  customTab: TabSession["customTab"];
  jobGenerates: TabSession["jobGenerates"];
  progress: PipelineProgress;
  fillBusy: boolean;
  generateBusy: boolean;
}) {
  const attachedJobGenerate = tabJob ? (jobGenerates[tabJob.jobId] ?? null) : null;
  const fillCanContinue = canContinueGenerate(
    attachedJobGenerate?.generateStatus,
    attachedJobGenerate?.checkpoint,
  );
  const customCanContinue = canContinueGenerate(customTab?.generateStatus, customTab?.checkpoint);
  const generateBusyFill =
    attachedJobGenerate?.generateStatus === "queued" ||
    attachedJobGenerate?.generateStatus === "running";
  const generateLabel =
    mainTab === "fill"
      ? generateBusyFill && attachedJobGenerate?.workKind !== "recommend"
        ? "Generating…"
        : fillCanContinue && attachedJobGenerate?.workKind !== "recommend"
          ? "Continue"
          : attachedJobGenerate?.generationId
            ? "Generate again"
            : "Generate"
      : generateBusy && customTab?.workKind !== "recommend"
        ? "Generating…"
        : customCanContinue && customTab?.workKind !== "recommend"
          ? "Continue"
          : customTab?.generationId
            ? "Generate again"
            : "Generate";
  const recommendLabel =
    mainTab === "fill"
      ? generateBusyFill && attachedJobGenerate?.workKind === "recommend"
        ? "Recommending…"
        : fillCanContinue && attachedJobGenerate?.workKind === "recommend"
          ? "Continue"
          : attachedJobGenerate?.recommendedResumeId
            ? "Recommend again"
            : "Recommend Resume"
      : generateBusy && customTab?.workKind === "recommend"
        ? "Recommending…"
        : customCanContinue && customTab?.workKind === "recommend"
          ? "Continue"
          : customTab?.recommendedResumeId
            ? "Recommend again"
            : "Recommend Resume";
  const running = progress.run != null;
  const refilling = progress.mode === FILL_MODE.refill;
  // While Run drives the tab it owns the progress text; Fill and Refill keep their names.
  const fillLabel = running
    ? "Fill page"
    : fillBusy && !refilling
      ? progress.message
      : progress.phase === "done"
        ? "Fill again"
        : "Fill page";
  const refillLabel =
    !running && fillBusy && refilling ? progress.message : "Refill flagged fields";
  const runLabel =
    running && fillBusy ? progress.message : progress.run?.report ? "Run again" : "Run";

  return {
    attachedJobGenerate,
    fillCanContinue,
    customCanContinue,
    generateLabel,
    recommendLabel,
    fillLabel,
    refillLabel,
    runLabel,
  };
}
