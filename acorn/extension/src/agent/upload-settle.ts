/**
 * Waits after a file is set on an input until the page finishes processing it. Uses
 * the debugger's Network domain to see XHR/Fetch the upload triggered, instead of
 * guessing from DOM text or class names.
 */

import type { Cdp } from "./cdp";

/** Minimum time after the file is accepted before we treat the network as settled. */
export const UPLOAD_PROCESS_MIN_MS = 800;
/** How long with no tracked requests in flight before we continue. */
export const UPLOAD_NETWORK_QUIET_MS = 500;
/** How often we re-check in-flight requests. */
export const UPLOAD_PROCESS_POLL_MS = 250;
/** Longest we wait for upload processing before continuing anyway. */
export const UPLOAD_PROCESS_MAX_MS = 45_000;

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

/** Polls until upload-related network activity settles or the max wait is reached. */
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
        if (Date.now() - quietSince >= UPLOAD_NETWORK_QUIET_MS) return;
      } else {
        quietSince = 0;
      }
      await sleep(UPLOAD_PROCESS_POLL_MS);
    }
  } finally {
    tracker.stop();
  }
}
