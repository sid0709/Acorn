/**
 * The map of the page a Run is on, for the sidebar's Now card: the page as a column, the parts the model
 * settled, the page's controls with what each shows, the points of the plan being carried out and what
 * became of each, the screens of the last survey, where the form moved, and the window. This keeps what the
 * card draws and lists from, in the page's CSS pixels; the picture is the sidebar's own
 * (`sidebar/PageMap.tsx`), not drawn on the page the person is reading. A run has a map from the moment it
 * has a page, and keeps it when it ends.
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
import type { AgentAction, AgentFieldState, AgentSurveyScreen } from "@acorn/shared/agent-contract";
import type { PipelineProgress } from "@acorn/shared/pipeline-types";

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
/** How far (CSS pixels) outside a control's box a point the plan bound to no control may land and still be on it. */
export const POINT_ON_CONTROL_PX = 6;

type PageSize = Pick<RunMap, "pageWidth" | "pageHeight" | "viewTop" | "viewHeight">;

/**
 * A control as the map keeps it: the page's name for it, its place, and what it says of itself. `secret`
 * says the run typed a secret into it (a password, a code), so what it shows is not kept.
 */
function mapControl(mark: ControlMark, secret: boolean): RunMapControl {
  const out: RunMapControl = {
    id: mark.id,
    kind: mark.kind,
    x: mark.x,
    y: mark.y,
    w: mark.w,
    h: mark.h,
  };
  if (mark.label) out.label = mark.label;
  if (mark.group) out.group = mark.group;
  if (mark.question) out.question = mark.question;
  if (mark.required) out.required = true;
  if (mark.empty !== undefined) out.empty = mark.empty;
  if (mark.checked !== undefined) out.checked = mark.checked;
  if (mark.invalid) out.invalid = true;
  if (mark.value && !secret) out.value = mark.value;
  return out;
}

/**
 * The progress as it is relayed to acorn-backend over the socket: what the page's controls show (typed
 * answers) stays in this browser. The sidebar reads the progress from the browser's own copy.
 */
export function relayedProgress(progress: PipelineProgress): PipelineProgress {
  const run = progress.run;
  const map = run?.map;
  if (!run || !map || !map.controls.some((control) => control.value !== undefined)) {
    return progress;
  }
  const controls = map.controls.map(({ value: _value, ...control }) => control);
  return { ...progress, run: { ...run, map: { ...map, controls } } };
}

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
  private marks: ControlMark[] = [];
  private moves: RunMapMove[] = [];
  /** The controls the run typed a secret into on this page: what they show is not kept. */
  private secrets = new Set<string>();
  /** The control the last point aimed at: what is typed next goes into it. */
  private aimed: string | undefined;

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
      // The key stays where the agent last put it: a look's own settled map (what still holds on the
      // page) carries the stretches, not the key, and is null while nothing is settled.
      key: this.keyOf(settled) ?? this.map?.key,
    };
  }

  /** What the run is doing now. */
  phase(phase: RunMapPhase): void {
    if (this.map) this.map = { ...this.map, phase };
  }

  /**
   * The page's controls, as the page reports them (CSS pixels). A link is left out: a page has many, they
   * are not questions, and a plan rarely aims at one.
   */
  setControls(marks: ControlMark[]): void {
    this.marks = marks.filter((mark) => mark.kind !== "link");
    this.placeControls();
  }

  private placeControls(): void {
    this.controls = this.marks.map((mark) => mapControl(mark, this.secrets.has(mark.id)));
    if (this.map) this.map = { ...this.map, controls: this.controls };
  }

  /** Where the form moved since the agent last saw the page (CSS pixels); null when nothing is known, which is no move. */
  setMoves(moves: LayoutMove[] | null): void {
    this.moves = (moves ?? []).map((move) => ({ from: move.from, at: move.at, dy: move.dy }));
    if (this.map) this.map = { ...this.map, moves: this.moves };
  }

  /** The form's to-do list as the model read it from the pictures (screenshot pixels in, CSS pixels kept). */
  setFields(fields: AgentFieldState[]): void {
    if (!this.map) return;
    this.map = {
      ...this.map,
      fields: fields.map((field) => ({
        label: field.label,
        y: field.y / this.scale,
        state: field.state,
      })),
    };
  }

  /** The agent says what is settled now (an empty map: nothing), and where the plan first acts. */
  settle(settled: SettledMap): void {
    if (this.map) {
      this.map = {
        ...this.map,
        settled: this.spans(settled),
        fence: this.fenceOf(settled),
        key: this.keyOf(settled),
      };
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
   * the look's own screen), all pending, each with the control it acts on. An action without a point
   * (typing, keys, a wait) is not a point; secret typing hides what the control it goes into shows.
   */
  plan(actions: AgentAction[], shot: Shot): void {
    const points: RunMapPoint[] = [];
    let hidden = false;
    for (const action of actions) {
      if (action.kind === "type" && action.secret && this.aimed && !this.secrets.has(this.aimed)) {
        this.secrets.add(this.aimed);
        hidden = true;
      }
      if (!POINT_KINDS.has(action.kind) || action.x == null || action.y == null) continue;
      const top = action.scrollTo ?? shot.viewport.scrollY;
      const x = (shot.viewport.scrollX + action.x) / shot.scale;
      const y = (top + action.y) / shot.scale;
      const control = action.mark?.id ?? this.controlAt(x, y);
      this.aimed = control;
      points.push({
        id: action.id,
        kind: action.kind,
        x,
        y,
        state: RUN_POINT_STATE.pending,
        ...(control ? { control } : {}),
      });
    }
    if (hidden) this.placeControls();
    if (this.map) this.map = { ...this.map, points };
  }

  /** The control a point lands on: the smallest whose box holds it, give or take POINT_ON_CONTROL_PX. */
  private controlAt(x: number, y: number): string | undefined {
    let best: RunMapControl | undefined;
    for (const control of this.controls) {
      const near =
        x >= control.x - POINT_ON_CONTROL_PX &&
        x <= control.x + control.w + POINT_ON_CONTROL_PX &&
        y >= control.y - POINT_ON_CONTROL_PX &&
        y <= control.y + control.h + POINT_ON_CONTROL_PX;
      if (near && (!best || control.w * control.h < best.w * best.h)) best = control;
    }
    return best?.id;
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
    this.marks = [];
    this.moves = [];
    this.secrets.clear();
    this.aimed = undefined;
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

  /** The band round the page's key control (CSS pixels); unset until the model named one. */
  private keyOf(settled: SettledMap | null): { from: number; to: number } | undefined {
    if (!settled?.key) return undefined;
    return { from: settled.key.from / this.scale, to: settled.key.to / this.scale };
  }

  /** Where the plan first acts (CSS pixels); unset until a plan has a point. */
  private fenceOf(settled: SettledMap | null): number | undefined {
    return settled && settled.fence > 0 ? settled.fence / this.scale : undefined;
  }
}
