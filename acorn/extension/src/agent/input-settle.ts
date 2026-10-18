/**
 * After text is typed, a page often asks a server what to show: a list of matches, a suggestion for a
 * postal code, an address. That takes a moment (the page waits a beat after the last key before it asks,
 * and the answer comes back later), and a screenshot taken at once shows a list that has not arrived, so
 * the model or the checker decides on nothing. So after a step that typed, the page is given its beat
 * and then until its requests are done, and only then looked at.
 */

import { trackUploadNetwork, type NetworkTracker } from "./upload-settle";

import type { Cdp } from "./cdp";

/** How long after the last key a page is given to start the request it makes for what was typed. */
export const INPUT_DEBOUNCE_MS = 300;
/** How long with no request in flight counts as the page being done. */
export const INPUT_NETWORK_QUIET_MS = 250;
/** How often the requests in flight are looked at. */
export const INPUT_SETTLE_POLL_MS = 100;
/** The longest the wait lasts: a page that never goes quiet is looked at as it is. */
export const INPUT_SETTLE_MAX_MS = 2_500;

export type InputWatch = {
  /** Waits for what the typing set off; call it after the last action of the step. */
  settle: (sleep: (ms: number) => Promise<void>) => Promise<void>;
};

/** Starts following requests, before the typing that may start them. */
export async function watchInputEffects(cdp: Cdp): Promise<InputWatch> {
  await cdp.send("Network.enable").catch(() => undefined);
  const tracker: NetworkTracker = trackUploadNetwork(cdp);
  return {
    async settle(sleep) {
      try {
        const began = Date.now();
        await sleep(INPUT_DEBOUNCE_MS);
        let quietSince = 0;
        while (Date.now() - began < INPUT_SETTLE_MAX_MS) {
          if (tracker.pending.size === 0) {
            if (quietSince === 0) quietSince = Date.now();
            if (Date.now() - quietSince >= INPUT_NETWORK_QUIET_MS) return;
          } else {
            quietSince = 0;
          }
          await sleep(INPUT_SETTLE_POLL_MS);
        }
      } finally {
        tracker.stop();
      }
    },
  };
}
