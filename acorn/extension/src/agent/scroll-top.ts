import type { Cdp } from "./cdp";

/** The pause after scrolling to the top, for what the page draws or loads there. */
export const TOP_SETTLE_MS = 150;

/**
 * Puts the page at its top at once (no smooth scrolling). A page that is mid-navigation has nothing to
 * scroll yet, which is not an error: the look that follows takes the page as it is.
 */
export async function scrollToTop(cdp: Cdp, sleep: (ms: number) => Promise<void>): Promise<void> {
  try {
    await cdp.send("Runtime.evaluate", {
      expression: `(() => { window.scrollTo({ top: 0, left: window.scrollX, behavior: "instant" }); })()`,
    });
  } catch {
    return;
  }
  await sleep(TOP_SETTLE_MS);
}
