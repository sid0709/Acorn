/**
 * Timers that keep time while the tab is in the background. Chrome stretches a
 * hidden page's own timers to a second or more (to a minute after a few minutes
 * hidden), and a Run works in many tabs at once, most of them hidden: every
 * short wait in a fill would crawl. A hidden page has the service worker, whose
 * timers Chrome leaves alone, count the time instead.
 */

import { MSG } from "../types";

/** Waits this short are not worth a round trip to the service worker. */
const PAGE_TIMER_MIN_RELAY_MS = 20;

/** Wait ms, at the right speed whether or not the tab is in front. */
export function pageDelay(ms: number): Promise<void> {
  const delay = Math.max(0, ms);
  if (document.visibilityState === "visible" || delay < PAGE_TIMER_MIN_RELAY_MS) {
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
  return new Promise((resolve) => {
    // The page's own timer stays as a backstop if the service worker cannot answer.
    const backstop = setTimeout(resolve, delay);
    const done = () => {
      clearTimeout(backstop);
      resolve();
    };
    try {
      chrome.runtime.sendMessage({ type: MSG.PAGE_DELAY, ms: delay }).then(done, () => undefined);
    } catch {
      /* extension reloaded under the page: the backstop resolves */
    }
  });
}

/** Run callback after ms, at the right speed in a hidden tab. Returns a cancel. */
export function pageTimeout(callback: () => void, ms: number): () => void {
  let cancelled = false;
  void pageDelay(ms).then(() => {
    if (!cancelled) callback();
  });
  return () => {
    cancelled = true;
  };
}
