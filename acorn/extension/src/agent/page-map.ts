/**
 * The map of the page a Run is on, for the sidebar's map card: the page as a column, the parts the model
 * settled, the page's controls, the points of the plan being carried out and what became of each, the
 * screens of the last survey, where the form moved, and the window. This keeps what the card draws from, in
 * the page's CSS pixels; the picture is the sidebar's own (`sidebar/page-minimap.ts`), not drawn on the page
 * the person is reading. A run has a map from the moment it has a page, and keeps it when it ends.
 */

import {
  RUN_MAP_PHASE,
  RUN_POINT_STATE,
  type RunMap,
  type RunMapControl,
  type RunMapMove,
  type RunMapPhase,
  type RunMapPoint,
  type RunMapScreen,
  type RunPointState,
} from "@acorn/shared/run-types";

import type { Shot } from "./capture";
import type { ControlMark, LayoutMove } from "./control-marks";
import type { PageState } from "./page-scroll";
import type { SettledMap } from "./survey";
import type { AgentAction, AgentSurveyScreen } from "@acorn/shared/agent-contract";

/** The kinds of action that aim at a point of the page. A scroll has a point too, but it is where the wheel turns, not a target. */
const POINT_KINDS: ReadonlySet<string> = new Set([
  "click",
  "double_click",
  "triple_click",
  "right_click",
  "hover",
  "upload",
]);
/** A point acted on further than this (CSS pixels) from where it was planned followed its control, or was found again. */
export const POINT_MOVED_PX = 3;

type PageSize = Pick<RunMap, "pageWidth" | "pageHeight" | "viewTop" | "viewHeight">;

/**
 * Which page a look is of: its address without the place on it the address names. An Apply button that
 * jumps to the form below changes the fragment (`#application`) and not the page; a title that changes
 * (an unread count, a step's name) is not another page either. Only another address is a new page,
 * which is looked at from its top and forgets what was settled on the last.
 */
export function pageKey(url: string | undefined): string {
  const [page] = (url ?? "").split("#");
  return page ?? "";
}

/** Keeps the map of the page the run is on and says it when asked. */
export class PageMapKeeper {
  private map: RunMap | undefined;
  private scale = 1;
  /** What the page reports between looks, kept for a map that is not there yet. */
  private controls: RunMapControl[] = [];
  private moves: RunMapMove[] = [];

  /** The map for the sidebar, or undefined before the run has a page. */
  get current(): RunMap | undefined {
    return this.map;
  }

  /** The page the run begins on, before its first look (CSS pixels): the card shows it at once. */
  start(state: PageState): void {
    this.map = this.fresh(RUN_MAP_PHASE.starting, {
      pageWidth: state.width,
      pageHeight: state.height,
      viewTop: state.y,
      viewHeight: state.view,
    });
  }

  /**
   * A look at the page: how large it is and where the window is. `settled` is what the agent last said
   * (screenshot pixels). The points of the last plan stay on the map until the next plan replaces them.
   */
  look(shot: Shot, settled: SettledMap | null): void {
    this.scale = shot.scale;
    const size: PageSize = {
      pageWidth: shot.viewport.pageWidth / shot.scale,
      pageHeight: shot.viewport.pageHeight / shot.scale,
      viewTop: shot.viewport.scrollY / shot.scale,
      viewHeight: shot.viewport.height / shot.scale,
    };
    this.map = {
      ...(this.map ?? this.fresh(RUN_MAP_PHASE.looking, size)),
      ...size,
      phase: RUN_MAP_PHASE.looking,
      settled: this.spans(settled),
      fence: this.fenceOf(settled),
    };
  }

  /** What the run is doing now. */
  phase(phase: RunMapPhase): void {
    if (this.map) this.map = { ...this.map, phase };
  }

  /** The page's controls, as the page reports them (CSS pixels). */
  setControls(marks: ControlMark[]): void {
    this.controls = marks.map((mark) => ({
      kind: mark.kind,
      x: mark.x,
      y: mark.y,
      w: mark.w,
      h: mark.h,
    }));
    if (this.map) this.map = { ...this.map, controls: this.controls };
  }

  /** Where the form moved since the agent last saw the page (CSS pixels); null when nothing is known, which is no move. */
  setMoves(moves: LayoutMove[] | null): void {
    this.moves = (moves ?? []).map((move) => ({ from: move.from, at: move.at, dy: move.dy }));
    if (this.map) this.map = { ...this.map, moves: this.moves };
  }

  /** The agent says what is settled now (an empty map: nothing), and where the plan first acts. */
  settle(settled: SettledMap): void {
    if (this.map) {
      this.map = { ...this.map, settled: this.spans(settled), fence: this.fenceOf(settled) };
    }
  }

  /** The window moved to a place (CSS pixels). */
  moveTo(viewTop: number): void {
    if (this.map) this.map = { ...this.map, viewTop };
  }

  /**
   * The screens of the survey just taken: `fresh` are the scroll positions (screenshot pixels) photographed
   * for it; the rest were reused from an earlier look. `viewHeight` is the window's, in screenshot pixels.
   * A look that was no survey (null) leaves the last survey's screens on the map.
   */
  survey(screens: AgentSurveyScreen[] | null, fresh: number[], viewHeight: number): void {
    if (!screens) return;
    const taken = new Set(fresh.map((y) => Math.round(y)));
    const list: RunMapScreen[] = screens.map((screen) => ({
      top: screen.scrollY / this.scale,
      height: viewHeight / this.scale,
      reused: !taken.has(Math.round(screen.scrollY)),
    }));
    if (this.map) this.map = { ...this.map, screens: list };
  }

  /**
   * The plan the agent sent: every point it aims at, measured on the survey screen the action names (or
   * the look's own screen), all pending. An action without a point (typing, keys, a wait) is not a point.
   */
  plan(actions: AgentAction[], shot: Shot): void {
    const points: RunMapPoint[] = [];
    for (const action of actions) {
      if (!POINT_KINDS.has(action.kind) || action.x == null || action.y == null) continue;
      const top = action.scrollTo ?? shot.viewport.scrollY;
      points.push({
        id: action.id,
        kind: action.kind,
        x: (shot.viewport.scrollX + action.x) / shot.scale,
        y: (top + action.y) / shot.scale,
        state: RUN_POINT_STATE.pending,
      });
    }
    if (this.map) this.map = { ...this.map, points };
  }

  /** What became of a point. `at` is where it was acted on (page CSS pixels), when that is known. */
  acted(id: string, state: RunPointState, at?: { x: number; y: number }): void {
    if (!this.map) return;
    const points = this.map.points.map((point) => {
      if (point.id !== id) return point;
      const next: RunMapPoint = { ...point, state };
      if (at) {
        const moved =
          Math.abs(at.x - point.x) > POINT_MOVED_PX || Math.abs(at.y - point.y) > POINT_MOVED_PX;
        if (moved || point.moved) next.moved = true;
        next.x = at.x;
        next.y = at.y;
      }
      return next;
    });
    this.map = { ...this.map, points };
  }

  /** A new page: the map of the last one is gone. */
  clear(): void {
    this.map = undefined;
    this.controls = [];
    this.moves = [];
  }

  /** A map with nothing known of the page but its size and what the page has reported since. */
  private fresh(phase: RunMapPhase, size: PageSize): RunMap {
    return {
      phase,
      ...size,
      settled: [],
      controls: this.controls,
      points: [],
      screens: [],
      moves: this.moves,
    };
  }

  private spans(settled: SettledMap | null): { from: number; to: number }[] {
    return (settled?.spans ?? []).map((span) => ({
      from: span.from / this.scale,
      to: span.to / this.scale,
    }));
  }

  /** Where the plan first acts (CSS pixels); unset until a plan has a point. */
  private fenceOf(settled: SettledMap | null): number | undefined {
    return settled && settled.fence > 0 ? settled.fence / this.scale : undefined;
  }
}
