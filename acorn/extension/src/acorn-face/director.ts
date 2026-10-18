import type { AcornFaceMode } from "@acorn/face";
import type { PipelinePhase, PipelineProgress } from "@acorn/shared/pipeline-types";

export type TabFaceInput = {
  signedIn: boolean;
  fillPhase?: PipelinePhase | null;
  hidden?: boolean;
};

export type CompanionFaceInput = {
  signedIn: boolean;
  authBusy: boolean;
  nameFocused: boolean;
  connected: boolean;
  anyTabWorking: boolean;
  focused: TabFaceInput;
  inspectOpen: boolean;
  connectionOpen: boolean;
  jobsLoading: boolean;
  jobsEmpty: boolean;
  jobsError: boolean;
  opening: boolean;
  afk: boolean;
  emptyIdle: boolean;
};

export function holdFromFill(phase?: PipelinePhase | null): AcornFaceMode | null {
  if (phase === "analyzing") return "thinking";
  if (phase === "fetching" || phase === "running") return "working";
  if (phase === "error") return "sad";
  return null;
}

export type BusyWorkerCounts = {
  thinking: number;
  working: number;
};

/** Tabs currently thinking or working on a Run. */
export function countBusyWorkers(pipelines: Record<string, PipelineProgress>): BusyWorkerCounts {
  let thinking = 0;
  let working = 0;
  for (const progress of Object.values(pipelines)) {
    const mode = holdFromFill(progress.phase);
    if (mode === "thinking") thinking += 1;
    else if (mode === "working") working += 1;
  }
  return { thinking, working };
}

/** Hold pose for the focused tab. */
export function resolveTabHold(input: TabFaceInput): AcornFaceMode {
  if (!input.signedIn) return "sleeping";
  const fill = holdFromFill(input.fillPhase);
  if (fill === "working" || fill === "thinking" || fill === "sad") return fill;
  if (input.hidden) return "sleeping";
  return "waiting";
}

/** Companion hold. One-shots (smile/wink/notice) overlay in playback. */
export function resolveCompanionHold(input: CompanionFaceInput): AcornFaceMode {
  const focused = resolveTabHold(input.focused);
  if (focused === "working" || focused === "thinking" || focused === "sad") return focused;
  if (input.opening || input.authBusy) return "working";
  if (input.jobsLoading || input.inspectOpen || input.connectionOpen) return "thinking";
  if (input.anyTabWorking) return "working";
  if (input.signedIn && !input.connected) return "sad";
  if (input.jobsError) return "sad";
  if (input.jobsEmpty) return input.emptyIdle ? "sleeping" : "sad";
  if (!input.signedIn) {
    if (input.authBusy) return "working";
    return input.nameFocused ? "waiting" : "sleeping";
  }
  if (input.afk) return "sleeping";
  if (focused === "sleeping") return "waiting";
  return focused;
}

export function tabInputFromProgress(
  signedIn: boolean,
  progress: PipelineProgress | null | undefined,
  hidden = false,
): TabFaceInput {
  return { signedIn, fillPhase: progress?.phase ?? "idle", hidden };
}

export function mergeFaceShot(hold: AcornFaceMode, shot: AcornFaceMode | null): AcornFaceMode {
  if (!shot) return hold;
  if (hold === "working" || hold === "thinking" || hold === "sad") return hold;
  return shot;
}
