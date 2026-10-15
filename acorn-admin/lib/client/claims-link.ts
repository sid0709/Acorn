"use client";

/**
 * Whether the console's live claim stream is up. It lives apart from the stream itself so the
 * cache can ask without importing it: the stream applies events to the cache, not the reverse.
 */

let live = false;
const listeners = new Set<() => void>();

export function setClaimsLive(next: boolean) {
  if (live === next) return;
  live = next;
  listeners.forEach((listener) => listener());
}

/** True while the stream is open and events are flowing. */
export function isClaimsLive(): boolean {
  return live;
}

export function subscribeClaimsLive(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
