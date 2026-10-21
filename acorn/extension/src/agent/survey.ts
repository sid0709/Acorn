/**
 * A survey: the whole page as screenshots from top to bottom, taken by the extension on its own.
 * A model that sees one screen at a time spends a call on every scroll; given the whole page it
 * plans the form in one answer, naming the screen each point is measured on. The extension then
 * scrolls to that screen before each action (`scrollForAction`), and refuses when the page is not
 * where, or the shape, the survey saw: a form that grew a message above the field would move every
 * point below it.
 */

import { captureShot, type Shot } from "./capture";
import {
  MARK_MOVE_PX,
  cropSpans,
  moved,
  placeSpans,
  scaleMoves,
  type LayoutMove,
  type MarkMove,
} from "./control-marks";
import {
  SCROLL_TOLERANCE_PX,
  pageState,
  scrollPageSlowly,
  type BlueMap,
  type ScrollContext,
} from "./page-scroll";

import type { Cdp } from "./cdp";
import type {
  AgentAction,
  AgentActionResult,
  AgentSettledMap,
  AgentSurveyScreen,
  AgentZoneShot,
} from "@acorn/shared/agent-contract";

/** The parts of the page the model will not come back to, in screenshot pixels. */
export type SettledMap = AgentSettledMap;

/** How much of a screen the next one repeats (CSS pixels), so a field on the seam is whole in one of them. */
export const SURVEY_OVERLAP_PX = 30;
/**
 * The most screens one survey takes. A page is surveyed to its very bottom however tall it is, and
 * what is cut short is never the end of it (the buttons that send the application are there), so this
 * is a guard against a page that grows without end, not a limit a real page reaches.
 */
export const SURVEY_MAX_SCREENS = 10_000;
/** The pause after scrolling, for what the page draws or loads at the new place. */
export const SURVEY_SETTLE_MS = 350;
/** A page this many times taller than its window is worth a survey; a shorter one is one screen. */
export const SURVEY_MIN_PAGE_RATIO = 1.25;
/** How much taller or shorter than the survey saw it the page may be and still be acted on. */
export const LAYOUT_TOLERANCE_PX = 12;
/** The least a screen may advance: a window shorter than the overlap would never move. */
const SURVEY_MIN_STEP_RATIO = 0.5;

/** A box on the page (CSS pixels) a survey keeps whole on a screen: a control with its field. */
export type SurveyBox = { y: number; h: number };

/**
 * The positions (CSS pixels) a survey of a page scrolls to: the top, then one screen less the overlap at
 * a time, and always the very bottom, whatever the height of the page. Given the page's controls, a screen
 * is moved up so that its top edge cuts none of them: a control cut by the edge of one screen and off the
 * next is whole on neither, and the model aims at what it cannot see. A screen never advances less than
 * half a window for it, and a control taller than the window is left as it falls.
 */
export function surveyPositions(
  pageHeight: number,
  viewHeight: number,
  controls: SurveyBox[] = [],
): number[] {
  if (!(viewHeight > 0) || pageHeight < viewHeight * SURVEY_MIN_PAGE_RATIO) return [];
  const last = pageHeight - viewHeight;
  const step = Math.max(viewHeight - SURVEY_OVERLAP_PX, viewHeight * SURVEY_MIN_STEP_RATIO);
  const least = viewHeight * SURVEY_MIN_STEP_RATIO;
  const whole = controls.filter((box) => box.h < viewHeight);
  const positions: number[] = [];
  for (let y = 0; y < last - 1 && positions.length < SURVEY_MAX_SCREENS - 1;) {
    positions.push(Math.round(y));
    y = aboveAnyCut(y + step, y + least, whole);
  }
  positions.push(Math.round(last));
  return positions;
}

/** The screen top `y` moved up, as far as `floor`, to above every control its edge would cut. */
function aboveAnyCut(y: number, floor: number, controls: SurveyBox[]): number {
  let top = y;
  for (let round = 0; round < controls.length; round += 1) {
    const cut = controls.filter((box) => box.y < top && box.y + box.h > top);
    if (cut.length === 0) break;
    const above = Math.min(...cut.map((box) => box.y)) - 1;
    if (above < floor) break;
    top = above;
  }
  return top;
}

/**
 * The order to visit positions in, starting from where the page is: on to the nearer end first, then
 * back across the rest, so the page is crossed once and the way back to the start is not travelled.
 */
export function visitOrder(positions: number[], from: number): number[] {
  if (positions.length === 0) return [];
  const sorted = [...positions].sort((a, b) => a - b);
  const top = sorted[0] ?? 0;
  const bottom = sorted[sorted.length - 1] ?? 0;
  const before = sorted.filter((y) => y <= from).reverse();
  const after = sorted.filter((y) => y > from);
  // Nearer the top: up to it (the screens above, last first), then down across the rest. Nearer the
  // bottom: down to it (the screens below, first first), then up across the rest.
  return from - top <= bottom - from ? [...before, ...after] : [...after, ...before];
}

export interface SurveyDeps {
  cdp: Cdp;
  sleep: (ms: number) => Promise<void>;
  checkStopped: () => void;
  /** Told where the window is (CSS pixels) each time the survey has scrolled, so the minimap can follow it. */
  onMove?: (viewTop: number) => void;
  /** The run's scrolling: the settled parts it keeps out of, and where it tells what it did. */
  scroll?: ScrollContext;
  /** The page's controls with their fields (CSS pixels), so no screen's edge cuts one. */
  controls?: () => SurveyBox[];
  /** Told each picture as it is taken, so it can go to the agent ahead of the look while the next is taken. */
  preload?: (dataUrl: string) => void;
}

/** What the last survey saw: its screens and how tall the page was (screenshot pixels). */
export interface SurveyMemory {
  screens: AgentSurveyScreen[];
  pageHeight: number;
}

/**
 * What a new survey may take from what the run already has instead of scrolling for it: the screens
 * of the last survey, and the photos taken when the zones of the plan just carried out were done.
 */
export interface SurveyReuse {
  previous: SurveyMemory | null;
  zones: AgentZoneShot[];
  /**
   * Whether the batch just carried out was a whole fast-fill plan that ran (`isReusableBatch`): then what it
   * did not touch is good while the page is as tall as it was. Otherwise only what lies above the fence is.
   */
  exact: boolean;
  /**
   * Where the batch just carried out first acted on the page (screenshot pixels): above it nothing changed,
   * when the batch stopped half way. 0 for one that ran whole (it may have gone to another step of the page)
   * and for one that read a résumé, which fills fields anywhere.
   */
  fence: number;
}

/** What a survey is: its screens, how many of them were taken from what the run already had, and how many were left out. */
export interface SurveyResult {
  screens: AgentSurveyScreen[];
  reused: number;
  /** How many screens were left out because they lie in a part the model settled. */
  left: number;
  /** The scroll positions (screenshot pixels) of the screens photographed for this survey, the look's own among them. */
  fresh: number[];
}

/**
 * Whether the batch just carried out leaves the last survey good for the parts it did not touch: every
 * action ran, every action belongs to a zone of a fast-fill plan (so each zone was photographed when it
 * was done), and none was an upload, which fills fields all over the page (a résumé read).
 */
export function isReusableBatch(actions: AgentAction[], results: AgentActionResult[]): boolean {
  return (
    actions.length > 0 &&
    results.every((result) => result.ok) &&
    actions.every((action) => action.zone != null && action.kind !== "upload")
  );
}

/**
 * Takes the screens of a page. A screen is left out when it lies wholly in a part the model settled (it
 * will not come back to it), while the page is as tall as when that was settled. A screen is reused, not
 * scrolled for and shot again, when a photo of its zone was taken when the zone was done (the freshest
 * look at it), or the last survey has it and nothing in the batch just done touched it; both only while the
 * page is as tall as the last survey saw it (±12 px), since a page that grew may have moved what is below
 * the growth. The rest are taken by scrolling to them with the wheel, slowly, crossing the page once from
 * where it is, and waiting for it to rest before each shot; the page is left where the last shot was taken.
 * When no screen needs taking the page does not move at all. `first` is the look just taken: the screen
 * at its own position is never shot again. Returns null when the page is about one screen tall, or
 * when every screen was left out. The caller hides the overlay around it.
 */
export async function captureSurvey(
  deps: SurveyDeps,
  first: Shot,
  reuse?: SurveyReuse,
  settled?: SettledMap | null,
): Promise<SurveyResult | null> {
  const scale = first.scale;
  const positions = surveyPositions(
    first.viewport.pageHeight / scale,
    first.viewport.height / scale,
    deps.controls?.() ?? [],
  );
  if (positions.length < 2) return null;
  // The look's own picture is the survey's first screen: it goes ahead while the others are taken.
  deps.preload?.(first.dataUrl);
  const original = first.viewport.scrollY / scale;
  const sameHeight =
    reuse?.previous != null &&
    reuse.exact &&
    Math.abs(reuse.previous.pageHeight - first.viewport.pageHeight) <= LAYOUT_TOLERANCE_PX * scale;
  // A page is the same above where the batch first acted, however it ended: those screens are still good.
  const unchanged = (at: number) =>
    sameHeight || (reuse != null && at + first.viewport.height <= reuse.fence);
  const settledNow = settledStill(settled, first.viewport.pageHeight, scale);
  const near = (a: number, b: number) => Math.abs(a - b) <= SCROLL_TOLERANCE_PX * scale;
  const taken = new Map<number, AgentSurveyScreen>();
  let reused = 0;
  let left = 0;
  const toTake: number[] = [];
  const fresh: number[] = [];
  for (const y of positions) {
    const at = y * scale;
    if (settledNow && isInSettled(settledNow, at, first.viewport.height)) {
      left += 1;
      continue;
    }
    if (Math.abs(y - original) < 1) {
      taken.set(y, { screenshot: first.dataUrl, scrollY: first.viewport.scrollY });
      fresh.push(first.viewport.scrollY);
      continue;
    }
    const have = unchanged(at)
      ? (reuse?.zones.find((zone) => near(zone.scrollY, at)) ??
        reuse?.previous?.screens.find((screen) => near(screen.scrollY, at)))
      : undefined;
    if (have) {
      taken.set(y, { screenshot: have.screenshot, scrollY: have.scrollY });
      reused += 1;
      continue;
    }
    toTake.push(y);
  }
  for (const y of visitOrder(toTake, original)) {
    deps.checkStopped();
    const landed = await scrollPageSlowly(deps.cdp, y, deps.sleep, deps.scroll, "survey");
    deps.onMove?.(landed.y);
    // A page that did not move shows nothing new at its place: only a scroll has something to load.
    if (landed.moved) await deps.sleep(SURVEY_SETTLE_MS);
    const shot = await captureShot(deps.cdp);
    deps.preload?.(shot.dataUrl);
    taken.set(y, { screenshot: shot.dataUrl, scrollY: shot.viewport.scrollY });
    fresh.push(shot.viewport.scrollY);
  }
  // Top to bottom, and two positions that landed on the same place (a short last step) are one screen.
  const seen = new Set<number>();
  const screens = [...taken.values()]
    .sort((a, b) => a.scrollY - b.scrollY)
    .filter((screen) => {
      const key = Math.round(screen.scrollY);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  // A survey of one screen is a survey when the rest were left out as settled.
  return screens.length >= 2 || (screens.length === 1 && left > 0)
    ? { screens, reused, left, fresh }
    : null;
}

/**
 * What of the settled parts is still good on a page that is `pageHeight` tall (screenshot pixels).
 * The same height keeps them. A move of the form (`moves`, screenshot pixels) places them with the
 * controls: each stretch goes where the controls it lies among went, and what lies where something
 * appeared is not settled. No control moved and the page grew: the new pixels are at the bottom, so the
 * coordinates still hold. The page shrank and nothing moved: the bottom was cut off. Null when none is.
 */
export function settledStill(
  settled: SettledMap | null | undefined,
  pageHeight: number,
  scale: number,
  moves?: LayoutMove[] | null,
): SettledMap | null {
  if (!settled || settled.spans.length === 0) return null;
  const sameHeight = Math.abs(settled.pageHeight - pageHeight) <= LAYOUT_TOLERANCE_PX * scale;
  const moving = moves != null && moves.length > 0;
  if (sameHeight && !moving) return settled;
  const spans = moving
    ? placeSpans(settled.spans, moves)
    : pageHeight >= settled.pageHeight
      ? settled.spans
      : cropSpans(settled.spans, pageHeight);
  return spans.length > 0 ? { ...settled, pageHeight, spans } : null;
}

/** Whether the screen that starts at `at` and is `height` tall (screenshot pixels) lies wholly in a settled part. */
function isInSettled(settled: SettledMap, at: number, height: number): boolean {
  return settled.spans.some((span) => span.from <= at + 1 && span.to >= at + height - 1);
}

/**
 * Takes the run's surveys and remembers what the last one saw, so the next takes again only what
 * changed (see `captureSurvey`). `noteBatch` says what the batch just carried out was, and the next
 * survey uses it once.
 */
export class SurveyKeeper {
  /** How many screens of the last survey were taken from what the run already had, and how many were left out. */
  reused = 0;
  left = 0;
  /** The scroll positions (screenshot pixels) of the screens the last survey photographed. */
  fresh: number[] = [];
  private memory: SurveyMemory | null = null;
  private reusable = false;
  private batchFence = 0;
  /** The parts of the page the model will not come back to (screenshot pixels), as the agent last said. */
  settled: SettledMap | null = null;
  /** Where the plan being carried out first acts on the page (screenshot pixels), as the agent last said. */
  private fence = 0;
  private scale = 1;
  private viewHeight = 0;
  /**
   * Where the form moved since the agent was last told of the page (CSS pixels). Null when it did not.
   * Cleared when the agent sends stretches already placed for that move.
   */
  private moves: LayoutMove[] | null = null;

  /** A look at the page: how large the window is, so the settled parts can be told in CSS pixels. */
  seen(shot: Shot): void {
    this.scale = shot.scale;
    this.viewHeight = shot.viewport.height / shot.scale;
  }

  /**
   * The settled parts of a page that is `pageHeight` tall (CSS pixels), for the run's scrolling to keep out
   * of; undefined when nothing is settled. A page of another height follows the controls' move.
   */
  blue(pageHeight: number): BlueMap | undefined {
    const settled = this.placed(pageHeight * this.scale);
    if (!settled || !(this.viewHeight > 0)) return undefined;
    return {
      viewHeight: this.viewHeight,
      spans: settled.spans.map((span) => ({
        from: span.from / this.scale,
        to: span.to / this.scale,
      })),
    };
  }

  noteBatch(actions: AgentAction[], results: AgentActionResult[]): void {
    this.reusable = isReusableBatch(actions, results);
    // Only a batch that stopped half way is known not to have left the page: one that ran whole may have
    // ended on the click that goes to the next step. A résumé fills fields all over the page, above the
    // point it was attached at too.
    const stoppedHalfWay = results.some((result) => !result.ok);
    const readsAResume = actions.some((action) => action.kind === "upload");
    this.batchFence = stoppedHalfWay && !readsAResume ? this.fence : 0;
  }

  /** The agent says what is settled now (an empty map: nothing). Those stretches match the page now. */
  setSettled(settled: SettledMap): void {
    this.settled = settled.spans.length > 0 ? settled : null;
    this.fence = settled.fence;
    this.moves = null;
  }

  /** The form moved. `moves` are in CSS pixels; null or empty when the list says nothing moved. */
  noteLayout(moves: LayoutMove[] | null): void {
    this.moves = moves && moves.length > 0 ? moves : null;
  }

  /** What is settled on the page as it is in `shot`, for the minimap: what still holds. */
  settledOn(shot: Shot): SettledMap | null {
    return this.placed(shot.viewport.pageHeight);
  }

  /** A new page: nothing that was seen or settled on the last one holds. */
  forget(): void {
    this.memory = null;
    this.settled = null;
    this.fence = 0;
    this.moves = null;
    this.reusable = false;
  }

  async take(
    deps: SurveyDeps,
    first: Shot,
    zoneShots: AgentZoneShot[],
  ): Promise<AgentSurveyScreen[] | null> {
    const reuse: SurveyReuse | undefined = this.memory
      ? {
          previous: this.memory,
          zones: this.reusable ? [...zoneShots] : [],
          exact: this.reusable,
          fence: this.batchFence,
        }
      : undefined;
    this.reusable = false;
    this.batchFence = 0;
    const taken = await captureSurvey(deps, first, reuse, this.placed(first.viewport.pageHeight));
    this.reused = taken?.reused ?? 0;
    this.left = taken?.left ?? 0;
    this.fresh = taken?.fresh ?? [];
    this.memory = taken ? { screens: taken.screens, pageHeight: first.viewport.pageHeight } : null;
    return taken?.screens ?? null;
  }

  /** The settled stretches placed for the page as it is now (screenshot pixels). */
  private placed(pageHeight: number): SettledMap | null {
    const moves = this.moves ? scaleMoves(this.moves, this.scale) : null;
    return settledStill(this.settled, pageHeight, this.scale, moves);
  }
}

/** What placing an action's point needs: waiting, the run's scrolling, and ways to find its target again. */
export interface PlaceDeps {
  sleep: (ms: number) => Promise<void>;
  scroll?: ScrollContext;
  /**
   * Finds an action's target again on a screenshot taken now, at the window's present place: where it is,
   * in screenshot pixels, or null when it cannot be found (or found in two places).
   */
  locate?: (action: AgentAction) => Promise<{ x: number; y: number } | null>;
  /** Finds it again by the control it was bound to when it was planned (docs 19.4m). */
  marks?: PlaceMarks;
}

/** What the page says of the control a point was bound to. */
export interface PlaceMarks {
  /**
   * How far that control has moved since the point was planned (CSS pixels), or null when it cannot be
   * told: it is gone, another shape, or the page cannot say.
   */
  move(action: AgentAction, scale: number): Promise<MarkMove | null>;
  /** Whether the point (CSS pixels in the window) is on the field of that control. */
  holds(action: AgentAction, x: number, y: number): Promise<boolean>;
  /**
   * How far the place the point was measured at has moved with the form since the survey (CSS pixels): 0
   * when nothing above it moved, null when it is not known (the point lies where something appeared, or no
   * survey has been taken). For a point bound to no control.
   */
  shift?(action: AgentAction, scale: number): number | null;
}

/**
 * Before an action whose point was measured on a screen of a survey: scrolls there and says where the
 * point is now (CSS pixels). When the page is not the shape the survey saw, a question that appeared or an
 * error message may have moved the point. The point was bound to the control it was on when it was planned,
 * so the control is asked for where it is now and the point goes with it, once the page agrees that the point
 * is on that control's field. A point bound to no control is placed by where the form moved: growth below
 * it cannot have moved it, and growth above it moved it by as much. Failing both, the target is found again
 * by its anchor (`locate`), a picture of what was round it. A target that cannot be found any way is not
 * guessed at: this throws, so the action is not done at a point that now means something else, and the
 * model looks again.
 */
export async function scrollForAction(
  cdp: Cdp,
  action: AgentAction,
  scale: number,
  deps: PlaceDeps,
): Promise<{ x: number; y: number }> {
  if (action.x == null || action.y == null) throw new Error("the action has no point");
  const own = { x: action.x / scale, y: action.y / scale };
  if (action.scrollTo == null) return own;
  const wanted = action.scrollTo / scale;
  // A point pinned to the screenshot it was measured on (no page height) is only put back when the
  // page has moved: most actions find it where they left it, and cost no scroll and no wait.
  if (
    action.pageHeight == null &&
    Math.abs((await pageState(cdp)).y - wanted) <= SCROLL_TOLERANCE_PX
  ) {
    return own;
  }
  const bound =
    action.pageHeight != null && action.mark
      ? ((await deps.marks?.move(action, scale)) ?? null)
      : null;
  if (bound && moved(bound)) {
    const placed = await placeOnControl(cdp, action, deps, { own, wanted, bound });
    if (placed) return placed;
  }
  const state = await scrollPageSlowly(cdp, wanted, deps.sleep, deps.scroll, "action");
  if (state.moved) await deps.sleep(SURVEY_SETTLE_MS);
  if (action.pageHeight != null) {
    const saw = action.pageHeight / scale;
    if (Math.abs(state.height - saw) > LAYOUT_TOLERANCE_PX) {
      // The page is not the height the survey saw, but the control the point was bound to is where it was:
      // nothing above it moved, so the point is still on it, as far as the page can say.
      const stayed =
        bound !== null &&
        !moved(bound) &&
        Math.abs(state.y - wanted) <= SCROLL_TOLERANCE_PX &&
        (await deps.marks?.holds(action, own.x, own.y)) === true;
      if (stayed) return own;
      const shifted = await placeByShift(cdp, action, scale, deps, { own, wanted, state });
      if (shifted) return shifted;
      const found = await findAgain(cdp, action, scale, deps, { wanted, saw, state });
      if (found) return found;
      throw new Error(
        `the page changed shape since the survey (it was ${Math.round(saw)} px tall and is ${Math.round(state.height)} px) and the target could not be found again: look again before acting`,
      );
    }
  }
  if (Math.abs(state.y - wanted) > SCROLL_TOLERANCE_PX) {
    throw new Error(
      `the page would not scroll to where the survey saw this (wanted ${Math.round(wanted)} px, got ${Math.round(state.y)} px): look again before acting`,
    );
  }
  return own;
}

/**
 * Puts the window where the control a point was bound to now is, keeping the point at the same place in
 * the window, and says where the point is (CSS pixels). Null when the page does not agree that the point
 * is on that control's field there, or the point would lie outside the window.
 */
async function placeOnControl(
  cdp: Cdp,
  action: AgentAction,
  deps: PlaceDeps,
  at: { own: { x: number; y: number }; wanted: number; bound: MarkMove },
): Promise<{ x: number; y: number } | null> {
  const { own, wanted, bound } = at;
  const state = await scrollPageSlowly(
    cdp,
    Math.max(0, wanted + bound.dy),
    deps.sleep,
    deps.scroll,
    "action",
  );
  if (state.moved) await deps.sleep(SURVEY_SETTLE_MS);
  // Where the point lies on the page now: where it lay on the survey's screen, with the control's move.
  const x = own.x + bound.dx;
  const y = wanted + own.y + bound.dy - state.y;
  if (x < 0 || y < 0 || (state.view > 0 && y >= state.view)) return null;
  return (await deps.marks?.holds(action, x, y)) === true ? { x, y } : null;
}

/**
 * Places a point bound to no control by where the form moved since the survey, as the page's controls
 * say: growth below the point left it where it was, growth above it moved it by as much, and the window
 * goes there with it. Null when the move is not known (the point lies where something appeared) or the
 * page would not scroll there.
 */
async function placeByShift(
  cdp: Cdp,
  action: AgentAction,
  scale: number,
  deps: PlaceDeps,
  at: { own: { x: number; y: number }; wanted: number; state: { y: number } },
): Promise<{ x: number; y: number } | null> {
  const shift = deps.marks?.shift?.(action, scale);
  if (shift == null) return null;
  if (Math.abs(shift) <= MARK_MOVE_PX) {
    return Math.abs(at.state.y - at.wanted) <= SCROLL_TOLERANCE_PX ? at.own : null;
  }
  const target = Math.max(0, at.wanted + shift);
  const landed = await scrollPageSlowly(cdp, target, deps.sleep, deps.scroll, "action");
  if (landed.moved) await deps.sleep(SURVEY_SETTLE_MS);
  // The window went where the point's part of the page went: the point keeps its place in the window, or
  // follows the rest of the way when the page could not scroll that far (its end).
  const y = at.wanted + at.own.y + shift - landed.y;
  if (y < 0 || (landed.view > 0 && y >= landed.view)) return null;
  return { x: at.own.x, y };
}

/**
 * Finds the target of an action again on a page that changed shape: where the survey saw it, and, if it
 * is not there, where the page's growth would have moved it (what appeared above it pushes it down by the
 * growth). Returns the point in CSS pixels, or null.
 */
async function findAgain(
  cdp: Cdp,
  action: AgentAction,
  scale: number,
  deps: PlaceDeps,
  seen: { wanted: number; saw: number; state: { y: number; height: number } },
): Promise<{ x: number; y: number } | null> {
  if (!deps.locate) return null;
  const here = await deps.locate(action);
  if (here) return { x: here.x / scale, y: here.y / scale };
  const shifted = Math.max(0, seen.wanted + (seen.state.height - seen.saw));
  if (Math.abs(shifted - seen.state.y) <= SCROLL_TOLERANCE_PX) return null;
  const landed = await scrollPageSlowly(cdp, shifted, deps.sleep, deps.scroll, "action");
  if (landed.moved) await deps.sleep(SURVEY_SETTLE_MS);
  const there = await deps.locate(action);
  return there ? { x: there.x / scale, y: there.y / scale } : null;
}
