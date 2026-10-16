import { isFillPhaseBusy, type PipelineProgress } from "@acorn/shared/pipeline-types";

import type { useTabSession } from "./use-tab-session";

type TabSession = ReturnType<typeof useTabSession>;

export const RUN_HINT =
  "Recommend a résumé, fill each page, and click Next or Submit until the application is done.";

/** Whether the active tab's attached job has Generate / Recommend in flight. */
export function isGenerateBusy(
  tabJob: TabSession["tabJob"],
  jobGenerates: TabSession["jobGenerates"],
): boolean {
  return (
    tabJob != null &&
    (jobGenerates[tabJob.jobId]?.generateStatus === "queued" ||
      jobGenerates[tabJob.jobId]?.generateStatus === "running")
  );
}

/** Whether any tab is running, generating, or recommending. */
export function isAnyTabWorking(
  pipelines: TabSession["pipelines"],
  jobGenerates: TabSession["jobGenerates"],
): boolean {
  return (
    Object.values(pipelines).some((row) => isFillPhaseBusy(row.phase)) ||
    Object.values(jobGenerates).some(
      (row) => row.generateStatus === "queued" || row.generateStatus === "running",
    )
  );
}

/** The attached job's generate state, and the Run button's label. */
export function actionBarState({
  tabJob,
  jobGenerates,
  progress,
  fillBusy,
}: {
  tabJob: TabSession["tabJob"];
  jobGenerates: TabSession["jobGenerates"];
  progress: PipelineProgress;
  fillBusy: boolean;
}) {
  const attachedJobGenerate = tabJob ? (jobGenerates[tabJob.jobId] ?? null) : null;
  const runLabel =
    progress.run != null && fillBusy
      ? progress.message
      : progress.run?.report
        ? "Run again"
        : "Run";

  return { attachedJobGenerate, runLabel };
}
