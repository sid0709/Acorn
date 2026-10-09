import { MSG } from "./types";

/**
 * Local debug capture: development builds (`bun run dev:acorn`) with VITE_ACORN_DEBUG=true.
 * Analyze then carries the page HTML and trees, and every trace event goes to the
 * backend's debug run (ACORN_DEBUG_DIR). A production build is always off, whatever
 * acorn/.env says, so a release can never send page HTML or traces.
 */
export const ACORN_DEBUG =
  import.meta.env.MODE === "development" && import.meta.env.VITE_ACORN_DEBUG === "true";

/** Page HTML beyond this is cut so Analyze stays under the API body limit. */
export const DEBUG_HTML_MAX_CHARS = 6_000_000;

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
  if (!ACORN_DEBUG) return;
  const entry: TraceEntry = { t: Date.now(), from: "page", event, data: data?.() };
  try {
    void chrome.runtime.sendMessage({ type: MSG.DEBUG_TRACE, entry }).catch(() => undefined);
  } catch {
    /* extension reloaded under the page */
  }
}
