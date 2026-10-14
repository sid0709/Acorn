import { MSG } from "./types";

import type { LogMeta } from "./tab-log-session";

/**
 * Developer conveniences: development builds (`bun run dev:acorn`) with
 * VITE_ACORN_DEBUG=true (the local API by default, capture problems shown in the
 * sidebar). A production build is always off.
 */
export const ACORN_DEBUG =
  import.meta.env.MODE === "development" && import.meta.env.VITE_ACORN_DEBUG === "true";

/** Lazy so production builds never pay for snapshots they would not send. */
export type TraceData = () => unknown;

export type TraceEntry = {
  t: number;
  from: "page" | "background";
  event: string;
  data?: unknown;
  frameId?: number;
  /** The Chrome tab the event is about, so it is written to that tab's log. */
  tabId?: number;
  /** How serious it is, and what it belongs to; see the Logs tab. */
  meta?: LogMeta;
};

/**
 * Content script: relay a trace event through the service worker, which writes it to
 * the tab's log. Nothing here leaves the browser; a support report carries the log
 * only when the person submits it.
 */
export function traceFromPage(event: string, data?: TraceData): void {
  const entry: TraceEntry = { t: Date.now(), from: "page", event, data: data?.() };
  try {
    void chrome.runtime.sendMessage({ type: MSG.DEBUG_TRACE, entry }).catch(() => undefined);
  } catch {
    /* extension reloaded under the page */
  }
}
