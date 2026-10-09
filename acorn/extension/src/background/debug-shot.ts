import { ACORN_DEBUG } from "../debug-trace";

import { blobToBase64, captureFullPage, captureVisible } from "./capture/full-page";
import { postDebug } from "./debug-post";
import { traceFromBackground } from "./debug-trace-sink";

/** captureVisibleTab allows about two calls a second per window. */
const SHOT_GAP_MS = 700;
/** Viewport shots closer than this are dropped so a busy run does not queue a backlog. */
const VISIBLE_SHOT_MIN_MS = 1200;
/** Matches the backend debug shot limit. A JPEG under this fits the API body cap once base64-encoded. */
const DEBUG_SHOT_MAX_BYTES = 4 << 20;
const DEBUG_SHOT_PATH = "/acorn/debug/shot";

let chain: Promise<void> = Promise.resolve();
let lastFinished = 0;
let lastAccepted = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Store a screenshot on the user's current debug run.
 * `full` stitches the whole page (and scrolls it, then puts the scroll back).
 * Viewport shots are the frequent ones and never move the page.
 * Both no-op unless this is a debug build, and both skip a tab that is not focused:
 * Chrome can only photograph the visible tab, and stitching a background tab would
 * scroll it while photographing whichever tab is in front.
 */
export function queueDebugShot(tabId: number, label: string, full: boolean): Promise<void> {
  if (!ACORN_DEBUG) return Promise.resolve();
  const now = Date.now();
  if (!full && now - lastAccepted < VISIBLE_SHOT_MIN_MS) return Promise.resolve();
  lastAccepted = now;
  const run = chain.then(async () => {
    const gap = SHOT_GAP_MS - (Date.now() - lastFinished);
    if (gap > 0) await sleep(gap);
    await take(tabId, label, full);
    lastFinished = Date.now();
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run.then(
    () => undefined,
    () => undefined,
  );
}

async function take(tabId: number, label: string, full: boolean): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  // Chrome captures only the tab in front; say so in the trace rather than leave a gap.
  if (!tab?.active || tab.windowId == null) {
    traceFromBackground("screen:skipped", () => ({ label, reason: "tab not in front" }), tabId);
    return;
  }
  const shot = full
    ? await captureFullPage(tabId, tab.windowId, DEBUG_SHOT_MAX_BYTES).catch(() =>
        captureVisible(tab.windowId),
      )
    : await captureVisible(tab.windowId);
  const image = await blobToBase64(shot.blob);
  await postDebug(DEBUG_SHOT_PATH, { image, label }, tabId);
}
