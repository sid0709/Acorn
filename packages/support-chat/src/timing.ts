import type { ClaimPush } from "./types";

/**
 * The User Timing measure each pushed change adds when it arrives: its duration is how long
 * the change took from the server accepting it to this side receiving it. Read them with
 * `performance.getEntriesByName(PUSH_DELAY_MEASURE)` or in the browser's Performance panel.
 * The two clocks are not synchronised, so a small offset is included.
 */
export const PUSH_DELAY_MEASURE = "acorn:support-push-delay";

/** Records how late a pushed change arrived; a push without a send time records nothing. */
export function recordPushDelay(push: Pick<ClaimPush, "sentAt">, kind: string): void {
  if (typeof push.sentAt !== "number" || typeof performance?.measure !== "function") return;
  const delay = Math.max(0, Date.now() - push.sentAt);
  const end = performance.now();
  try {
    performance.measure(PUSH_DELAY_MEASURE, { start: end - delay, end, detail: { kind } });
  } catch {
    // A browser that rejects the options form simply keeps no measure.
  }
}
