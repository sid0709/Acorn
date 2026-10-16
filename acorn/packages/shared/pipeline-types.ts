/** Run progress contract (extension ↔ Chrome side panel). */

import type { RunProgress } from "./run-types";

export type PipelinePhase = "idle" | "fetching" | "analyzing" | "running" | "done" | "error";

export interface PipelineProgress {
  phase: PipelinePhase;
  message: string;
  /** Set while Run drives this tab, and on its last update. */
  run?: RunProgress;
  error?: string;
  /** The backend's stable code and the HTTP status behind `error`, for the plain-words message. */
  errorCode?: string;
  errorStatus?: number;
  /** Wall-clock ms for the whole run (set on done/error). */
  durationMs?: number;
}

export const IDLE_PIPELINE_PROGRESS: PipelineProgress = {
  phase: "idle",
  message: "Idle",
};

export function isFillPhaseBusy(phase: PipelinePhase): boolean {
  return phase === "fetching" || phase === "analyzing" || phase === "running";
}

export function mergePipelineProgress(
  prev: PipelineProgress,
  next: PipelineProgress,
): PipelineProgress {
  const starting = next.phase === "fetching";
  return {
    ...prev,
    ...next,
    run: starting ? next.run : (next.run ?? prev.run),
    errorCode: starting ? next.errorCode : (next.errorCode ?? prev.errorCode),
    errorStatus: starting ? next.errorStatus : (next.errorStatus ?? prev.errorStatus),
  };
}
