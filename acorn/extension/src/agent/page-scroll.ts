/**
 * Moving the page: where it is, putting it somewhere exactly, and getting there the way a person does,
 * with the mouse wheel in small steps. A programmatic jump (`window.scrollTo`) makes the page flash
 * from one place to another and gives what loads on scroll no chance to load, so a survey, and the
 * scroll before an action, go slowly by the wheel and use the jump only to land exactly when the wheel
 * could not.
 */

import { waitForScrollRest } from "./scroll-rest";

import type { Cdp } from "./cdp";

/** The most one wheel event scrolls (CSS pixels), so the page moves in small steps a person could follow. */
export const SLOW_SCROLL_STEP_PX = 120;
/** The most wheel events one scroll sends: a long way is covered with larger steps, not more of them. */
export const SLOW_SCROLL_MAX_EVENTS = 60;
/** The pause between wheel events. */
export const SLOW_SCROLL_STEP_MS = 40;
/** How many times the wheel is tried again when the page did not land where it was asked to. */
export const SLOW_SCROLL_ROUNDS = 3;
/** How far from where it was asked to be the page may land (a page may snap or clamp). */
export const SCROLL_TOLERANCE_PX = 3;
/**
 * Where the wheel is turned, in CSS pixels: at the page's left edge, where no list or text box of the
 * page sits to take the wheel for itself, and a hover there changes nothing.
 */
const WHEEL_POINT = { x: 4, y: 120 };

type Layout = {
  cssVisualViewport: { pageY: number; clientWidth?: number; clientHeight?: number };
  cssContentSize: { width?: number; height: number };
};

/** What the page is doing now: where it is scrolled, how large it is, and how large the window is (CSS pixels). */
export type PageState = {
  y: number;
  height: number;
  width: number;
  view: number;
  viewWidth: number;
};

export async function pageState(cdp: Cdp): Promise<PageState> {
  const metrics = await cdp.send<Layout>("Page.getLayoutMetrics");
  return {
    y: metrics.cssVisualViewport.pageY,
    height: metrics.cssContentSize.height,
    width: metrics.cssContentSize.width ?? 0,
    view: metrics.cssVisualViewport.clientHeight ?? 0,
    viewWidth: metrics.cssVisualViewport.clientWidth ?? 0,
  };
}

/** Puts the page at a place at once (no smooth scrolling) and says where it landed. */
export async function scrollPageTo(cdp: Cdp, y: number): Promise<PageState> {
  await cdp.send("Runtime.evaluate", {
    expression: `(() => { window.scrollTo({ top: ${Number(y)}, left: window.scrollX, behavior: "instant" }); })()`,
  });
  return pageState(cdp);
}

/** A stretch of the page (CSS pixels from its top). */
export type Stretch = { from: number; to: number };

/** The parts of the page the model settled and how tall the window is, while they hold. */
export interface BlueMap {
  spans: Stretch[];
  viewHeight: number;
}

/** Why the run scrolls by itself. */
export type ScrollReason = "survey" | "action" | "new page";

/** What a scroll the run makes by itself knows of the page, and where it tells what it did. */
export interface ScrollContext {
  /** The settled (blue) parts of a page that is `pageHeight` tall (CSS pixels), or undefined when none holds. */
  blue(pageHeight: number): BlueMap | undefined;
  /** Told each scroll the run made by itself: where from, where to, why, and whether it was refused. */
  note(move: { from: number; to: number; reason: ScrollReason; refused?: boolean }): void;
}

/** The window crosses a settled part quickly: large steps with almost no pause between them. */
export const FAST_SCROLL_STEP_PX = 600;
export const FAST_SCROLL_STEP_MS = 6;

/** Whether the window, with its top at `y`, lies wholly in a settled part. */
export function windowInBlue(blue: BlueMap | undefined, y: number): boolean {
  return (
    blue != null &&
    blue.spans.some((span) => span.from <= y + 1 && span.to >= y + blue.viewHeight - 1)
  );
}

/**
 * Turns the wheel by `delta` CSS pixels (positive goes down) from a window whose top is at `from`. In small
 * steps, except where the window lies in a settled part: that is crossed fast, since there is nothing to
 * look at in it.
 */
async function turnWheel(
  cdp: Cdp,
  from: number,
  delta: number,
  sleep: (ms: number) => Promise<void>,
  blue: BlueMap | undefined,
): Promise<void> {
  const direction = Math.sign(delta);
  const slow = Math.max(SLOW_SCROLL_STEP_PX, Math.abs(delta) / SLOW_SCROLL_MAX_EVENTS);
  let at = from;
  let left = Math.abs(delta);
  while (left > 0.5) {
    const crossing = windowInBlue(blue, at);
    const step = Math.min(left, crossing ? FAST_SCROLL_STEP_PX : slow);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: WHEEL_POINT.x,
      y: WHEEL_POINT.y,
      deltaX: 0,
      deltaY: direction * step,
    });
    await sleep(crossing ? FAST_SCROLL_STEP_MS : SLOW_SCROLL_STEP_MS);
    at += direction * step;
    left -= step;
  }
}

/**
 * Scrolls the page to a place with the mouse wheel, slowly, and waits for it to come to rest there.
 * The wheel is turned for the distance, the page's place is read, and what is left is turned again, a
 * few times; a page that still is not there (it clamps, or something else took the wheel) is put there
 * at once, so the place is always right. Says where the page landed.
 *
 * The run never goes to a settled part: a scroll whose window would lie wholly in one is not made (an
 * action's own target is the exception, since it has to be reached), and one that crosses a settled
 * part crosses it fast. Every scroll is told to `scroll.note`, so the log says where the page went and why.
 * `moved` says whether the page went anywhere: a caller that waits for what a scroll loads has nothing to
 * wait for when it did not.
 */
export async function scrollPageSlowly(
  cdp: Cdp,
  y: number,
  sleep: (ms: number) => Promise<void>,
  scroll?: ScrollContext,
  reason: ScrollReason = "survey",
): Promise<PageState & { moved: boolean }> {
  let state = await pageState(cdp);
  const began = state.y;
  const blue = scroll?.blue(state.height);
  if (reason !== "action" && windowInBlue(blue, y)) {
    scroll?.note({ from: began, to: y, reason, refused: true });
    return { ...state, moved: false };
  }
  for (let round = 0; round < SLOW_SCROLL_ROUNDS; round += 1) {
    const delta = y - state.y;
    if (Math.abs(delta) <= SCROLL_TOLERANCE_PX) break;
    await turnWheel(cdp, state.y, delta, sleep, blue);
    await waitForScrollRest(cdp, sleep);
    state = await pageState(cdp);
  }
  if (Math.abs(y - state.y) > SCROLL_TOLERANCE_PX) state = await scrollPageTo(cdp, y);
  const moved = Math.abs(state.y - began) > SCROLL_TOLERANCE_PX;
  if (moved) scroll?.note({ from: began, to: state.y, reason });
  return { ...state, moved };
}
