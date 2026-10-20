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
  cssVisualViewport: { pageY: number };
  cssContentSize: { height: number };
};

/** What the page is doing now: where it is scrolled, and how tall it is (CSS pixels). */
export async function pageState(cdp: Cdp): Promise<{ y: number; height: number }> {
  const metrics = await cdp.send<Layout>("Page.getLayoutMetrics");
  return { y: metrics.cssVisualViewport.pageY, height: metrics.cssContentSize.height };
}

/** Puts the page at a place at once (no smooth scrolling) and says where it landed. */
export async function scrollPageTo(cdp: Cdp, y: number): Promise<{ y: number; height: number }> {
  await cdp.send("Runtime.evaluate", {
    expression: `(() => { window.scrollTo({ top: ${Number(y)}, left: window.scrollX, behavior: "instant" }); })()`,
  });
  return pageState(cdp);
}

/** Turns the wheel by `delta` CSS pixels (positive goes down) in small steps. */
async function turnWheel(
  cdp: Cdp,
  delta: number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const step = Math.max(SLOW_SCROLL_STEP_PX, Math.abs(delta) / SLOW_SCROLL_MAX_EVENTS);
  const events = Math.max(1, Math.ceil(Math.abs(delta) / step));
  for (let i = 0; i < events; i += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: WHEEL_POINT.x,
      y: WHEEL_POINT.y,
      deltaX: 0,
      deltaY: delta / events,
    });
    await sleep(SLOW_SCROLL_STEP_MS);
  }
}

/**
 * Scrolls the page to a place with the mouse wheel, slowly, and waits for it to come to rest there.
 * The wheel is turned for the distance, the page's place is read, and what is left is turned again, a
 * few times; a page that still is not there (it clamps, or something else took the wheel) is put there
 * at once, so the place is always right. Says where the page landed.
 */
export async function scrollPageSlowly(
  cdp: Cdp,
  y: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ y: number; height: number }> {
  for (let round = 0; round < SLOW_SCROLL_ROUNDS; round += 1) {
    const state = await pageState(cdp);
    const delta = y - state.y;
    if (Math.abs(delta) <= SCROLL_TOLERANCE_PX) return state;
    await turnWheel(cdp, delta, sleep);
    await waitForScrollRest(cdp, sleep);
  }
  const state = await pageState(cdp);
  if (Math.abs(y - state.y) <= SCROLL_TOLERANCE_PX) return state;
  return scrollPageTo(cdp, y);
}
