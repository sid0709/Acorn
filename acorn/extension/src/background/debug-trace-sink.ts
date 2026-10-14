import { LOG_KIND, logTab } from "../tab-log-session";

import type { TraceData, TraceEntry } from "../debug-trace";
import type { LogMeta } from "../tab-log-session";

/**
 * Write one trace entry to its tab's log. Traces stay in the browser: the Logs tab
 * shows them, and a support report carries them only when the person submits it.
 */
export function sinkTrace(entry: TraceEntry): void {
  logTab(
    entry.tabId,
    LOG_KIND.event,
    `${entry.from} · ${entry.event}`,
    () => entry.data ?? {},
    entry.meta,
  );
}

/** Background code (pipeline, router): trace straight to the tab's log. */
export function traceFromBackground(
  event: string,
  data?: TraceData,
  tabId?: number,
  meta?: LogMeta,
): void {
  sinkTrace({ t: Date.now(), from: "background", event, data: data?.(), tabId, meta });
}
