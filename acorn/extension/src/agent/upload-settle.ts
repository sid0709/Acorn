/**
 * Waits after a file is set on an input until the page finishes processing it. Uses
 * the debugger's Network domain to see XHR/Fetch the upload triggered, instead of
 * guessing from DOM text or class names.
 */

import { pageState } from "./page-scroll";

import type { Cdp } from "./cdp";

/** Minimum time after the file is accepted before we treat the network as settled. */
export const UPLOAD_PROCESS_MIN_MS = 800;
/** How long with no tracked requests in flight before we continue. */
export const UPLOAD_NETWORK_QUIET_MS = 500;
/** How often we re-check in-flight requests. */
export const UPLOAD_PROCESS_POLL_MS = 250;
/** Longest we wait for upload processing before continuing anyway. */
export const UPLOAD_PROCESS_MAX_MS = 45_000;
/**
 * After the network is quiet, how long the page's height must stay the same. A résumé autofill
 * keeps growing the form after its request has finished, and a survey taken then plans against a
 * page that is about to move.
 */
export const UPLOAD_LAYOUT_QUIET_MS = 600;
/** How often the page's height is read while waiting for that. */
export const UPLOAD_LAYOUT_POLL_MS = 200;
/** The longest that extra wait lasts. A form that never stops growing is surveyed as it is. */
export const UPLOAD_LAYOUT_MAX_MS = 8_000;

/** Request types that usually carry résumé parsing or autofill after an upload. */
const UPLOAD_NETWORK_TYPES = new Set(["XHR", "Fetch"]);

export type NetworkTracker = {
  pending: Set<string>;
  stop: () => void;
};

/** Follows the page's XHR and fetch requests: which are in flight now. */
export function trackUploadNetwork(cdp: Cdp): NetworkTracker {
  const pending = new Set<string>();
  const stop = cdp.onEvent((method, params) => {
    if (method === "Network.requestWillBeSent") {
      const type = params.type;
      const id = params.requestId;
      if (typeof type === "string" && typeof id === "string" && UPLOAD_NETWORK_TYPES.has(type)) {
        pending.add(id);
      }
    }
    if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
      const id = params.requestId;
      if (typeof id === "string") pending.delete(id);
    }
  });
  return { pending, stop };
}

/** Polls until upload-related network activity settles, then until the page stops changing height. */
export async function waitForUploadProcessing(
  cdp: Cdp,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  await cdp.send("Network.enable").catch(() => undefined);
  const tracker = trackUploadNetwork(cdp);
  const started = Date.now();
  let quietSince = 0;
  try {
    await sleep(UPLOAD_PROCESS_MIN_MS);
    while (Date.now() - started < UPLOAD_PROCESS_MAX_MS) {
      if (tracker.pending.size === 0) {
        if (quietSince === 0) quietSince = Date.now();
        if (Date.now() - quietSince >= UPLOAD_NETWORK_QUIET_MS) break;
      } else {
        quietSince = 0;
      }
      await sleep(UPLOAD_PROCESS_POLL_MS);
    }
  } finally {
    tracker.stop();
  }
  await waitForPageLayout(cdp, sleep);
}

/**
 * Waits until the page's height stays still. Called after the upload's requests have finished,
 * because the form often grows a moment later as the site fills fields in.
 */
async function waitForPageLayout(cdp: Cdp, sleep: (ms: number) => Promise<void>): Promise<void> {
  let last: number;
  try {
    last = (await pageState(cdp)).height;
  } catch {
    return;
  }
  const began = Date.now();
  let quietSince = began;
  while (Date.now() - began < UPLOAD_LAYOUT_MAX_MS) {
    await sleep(UPLOAD_LAYOUT_POLL_MS);
    let height: number;
    try {
      height = (await pageState(cdp)).height;
    } catch {
      return;
    }
    if (height !== last) {
      last = height;
      quietSince = Date.now();
      continue;
    }
    if (Date.now() - quietSince >= UPLOAD_LAYOUT_QUIET_MS) return;
  }
}
