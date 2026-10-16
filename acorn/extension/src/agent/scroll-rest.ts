import type { Cdp } from "./cdp";

/** How often the page's scroll position is read while waiting for it to stop. */
export const SCROLL_REST_POLL_MS = 50;
/** The longest the wait for a scroll to stop lasts: a page that never stops is looked at as it is. */
export const SCROLL_REST_MAX_MS = 800;
/** Two reads this close are the same place. */
export const SCROLL_REST_TOLERANCE_PX = 1;

/**
 * Waits for the page to stop scrolling before it is looked at. Keys and clicks start smooth scrolls
 * that are still running when the screenshot is taken, and a look at a page in motion gives the
 * model points that are already wrong.
 */
export async function waitForScrollRest(
  cdp: Cdp,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  let last: number | null = null;
  for (let waited = 0; waited <= SCROLL_REST_MAX_MS; waited += SCROLL_REST_POLL_MS) {
    let y: number;
    try {
      const metrics = await cdp.send<{ cssVisualViewport?: { pageY?: number } }>(
        "Page.getLayoutMetrics",
      );
      y = metrics.cssVisualViewport?.pageY ?? 0;
    } catch {
      return;
    }
    if (last !== null && Math.abs(y - last) <= SCROLL_REST_TOLERANCE_PX) return;
    last = y;
    await sleep(SCROLL_REST_POLL_MS);
  }
}
