import { MSG } from "./types";

/**
 * Developer conveniences: development builds (`bun run dev:acorn`) with
 * VITE_ACORN_DEBUG=true (the local API by default, capture problems shown in the
 * sidebar). A production build is always off.
 */
export const ACORN_DEBUG =
  import.meta.env.MODE === "development" && import.meta.env.VITE_ACORN_DEBUG === "true";

/**
 * Process capture, in every build unless built with VITE_ACORN_CAPTURE=false: each
 * tab session's step trace (page addresses, labels, decisions) goes to the backend,
 * which keeps it for a few days so a support report carries the whole session. The
 * page's HTML never leaves the browser, and passwords never leave the page.
 */
export const ACORN_CAPTURE = import.meta.env.VITE_ACORN_CAPTURE !== "false";

/** Lazy so production builds never pay for snapshots they would not send. */
export type TraceData = () => unknown;

export type TraceEntry = {
  t: number;
  from: "page" | "background";
  event: string;
  data?: unknown;
  frameId?: number;
  /** The Chrome tab the event is about, so the backend files it in that tab's debug run. */
  tabId?: number;
};

/** Content script: relay a trace event through the service worker. */
export function traceFromPage(event: string, data?: TraceData): void {
  if (!ACORN_CAPTURE) return;
  const entry: TraceEntry = { t: Date.now(), from: "page", event, data: data?.() };
  try {
    void chrome.runtime.sendMessage({ type: MSG.DEBUG_TRACE, entry }).catch(() => undefined);
  } catch {
    /* extension reloaded under the page */
  }
}
