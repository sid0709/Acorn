import { isFillPhaseBusy, type PipelineProgress } from "@acorn/shared/pipeline-types";

export const RUN_HINT =
  "Recommend a résumé, fill each page, and click Next or Submit until the application is done.";

/** Whether any tab has a Run working. */
export function isAnyTabWorking(pipelines: Record<string, PipelineProgress>): boolean {
  return Object.values(pipelines).some((row) => isFillPhaseBusy(row.phase));
}

/** The Run button's label. */
export function runButtonLabel(progress: PipelineProgress, fillBusy: boolean): string {
  if (progress.run != null && fillBusy) return progress.message;
  return progress.run?.report ? "Run again" : "Run";
}
