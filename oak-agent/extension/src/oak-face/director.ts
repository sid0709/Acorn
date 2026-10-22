import type { OakFaceMode } from "@oak/face";
import type { PipelinePhase, PipelineProgress } from "../../../shared/pipeline-types";
import type { JdShotStatus } from "../tab-page-session";

export type RowFaceInput = {
  fillPhase?: PipelinePhase | null;
  resumeSkipped?: boolean;
  jdStatus?: JdShotStatus | null;
  sending?: boolean;
  downloading?: boolean;
};

export type TabFaceInput = {
  signedIn: boolean;
  fillPhase?: PipelinePhase | null;
  resumeSkipped?: boolean;
  jdStatus?: JdShotStatus | null;
  hidden?: boolean;
};

export type CompanionFaceInput = {
  signedIn: boolean;
  authBusy: boolean;
  nameFocused: boolean;
  connected: boolean;
  anyTabWorking: boolean;
  focused: TabFaceInput;
  qaBusy: boolean;
  qaError: boolean;
  inspectOpen: boolean;
  connectionOpen: boolean;
  pagesEmpty: boolean;
  remembering: boolean;
  sending: boolean;
  afk: boolean;
  emptyIdle: boolean;
};

export function holdFromFill(
  phase?: PipelinePhase | null,
  resumeSkipped = false,
): OakFaceMode | null {
  if (phase === "analyzing") return "thinking";
  if (phase === "fetching" || phase === "running") return "working";
  if (phase === "error") return "sad";
  if (phase === "done" && resumeSkipped) return "sad";
  return null;
}

/** A JD shot reads the page and matches a résumé: the face thinks while it runs. */
export function holdFromJdShot(status?: JdShotStatus | null): OakFaceMode | null {
  if (status === "running") return "thinking";
  if (status === "failed") return "sad";
  return null;
}

/** Hold pose for one remembered page. One-shots are applied by playback. */
export function resolveRowHold(input: RowFaceInput): OakFaceMode {
  if (input.sending || input.downloading) return "working";
  const fill = holdFromFill(input.fillPhase, input.resumeSkipped);
  if (fill === "working" || fill === "thinking" || fill === "sad") return fill;
  const jd = holdFromJdShot(input.jdStatus);
  if (jd) return jd;
  return "waiting";
}

export type BusyWorkerCounts = {
  thinking: number;
  working: number;
};

/** Unique tabs currently thinking or working (Fill and JD shot). */
export function countBusyWorkers(
  pipelines: Record<string, PipelineProgress>,
  pages: Array<{ tabId: number; jdStatus: JdShotStatus }>,
): BusyWorkerCounts {
  const modes = new Map<string, OakFaceMode>();
  for (const [tabId, progress] of Object.entries(pipelines)) {
    const mode = holdFromFill(progress.phase, progress.resumeUpload?.status === "skipped");
    if (mode === "thinking" || mode === "working") modes.set(tabId, mode);
  }
  for (const page of pages) {
    const key = String(page.tabId);
    if (modes.has(key)) continue;
    const mode = holdFromJdShot(page.jdStatus);
    if (mode === "thinking") modes.set(key, mode);
  }
  let thinking = 0;
  let working = 0;
  for (const mode of modes.values()) {
    if (mode === "thinking") thinking += 1;
    else working += 1;
  }
  return { thinking, working };
}

/** Hold pose for the focused tab. */
export function resolveTabHold(input: TabFaceInput): OakFaceMode {
  if (!input.signedIn) return "sleeping";
  const fill = holdFromFill(input.fillPhase, input.resumeSkipped);
  if (fill === "working" || fill === "thinking" || fill === "sad") return fill;
  const jd = holdFromJdShot(input.jdStatus);
  if (jd) return jd;
  if (input.hidden) return "sleeping";
  return "waiting";
}

/** Companion hold. One-shots (smile/wink/notice) overlay in playback. */
export function resolveCompanionHold(input: CompanionFaceInput): OakFaceMode {
  const focused = resolveTabHold(input.focused);
  if (focused === "working" || focused === "thinking" || focused === "sad") return focused;
  if (input.qaBusy) return "thinking";
  if (input.qaError) return "sad";
  if (input.remembering || input.sending || input.authBusy) return "working";
  if (input.inspectOpen || input.connectionOpen) return "thinking";
  if (input.anyTabWorking) return "working";
  if (input.signedIn && !input.connected) return "sad";
  if (input.pagesEmpty) return input.emptyIdle ? "sleeping" : "thinking";
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
  jdStatus?: JdShotStatus | null,
  hidden = false,
): TabFaceInput {
  return {
    signedIn,
    fillPhase: progress?.phase ?? "idle",
    resumeSkipped: progress?.resumeUpload?.status === "skipped",
    jdStatus: jdStatus ?? null,
    hidden,
  };
}

export function isLiveRowMode(mode: OakFaceMode, selected: boolean): boolean {
  if (selected) return true;
  return mode !== "waiting";
}

export function mergeFaceShot(hold: OakFaceMode, shot: OakFaceMode | null): OakFaceMode {
  if (!shot) return hold;
  if (hold === "working" || hold === "thinking" || hold === "sad") return hold;
  return shot;
}
