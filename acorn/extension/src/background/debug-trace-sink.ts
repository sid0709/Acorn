import { ACORN_CAPTURE, type TraceData, type TraceEntry } from "../debug-trace";
import { LOG_KIND, logTab } from "../tab-log-session";

import { postDebug } from "./debug-post";

/** The backend route that appends trace entries to the current debug run. */
const DEBUG_LOG_PATH = "/acorn/debug/log";
/** Entries sent per request; the rest wait for the next flush. */
const TRACE_BATCH_MAX = 50;

const pending: TraceEntry[] = [];
let flushing: Promise<void> | null = null;

async function flush(): Promise<void> {
  while (pending.length) {
    const entries = pending.splice(0, TRACE_BATCH_MAX);
    // Each tab's entries go to that tab's debug run. Best effort: a refused or
    // unreachable upload drops the batch and says so once.
    const byTab = new Map<number | undefined, TraceEntry[]>();
    for (const entry of entries) byTab.set(entry.tabId, [...(byTab.get(entry.tabId) ?? []), entry]);
    for (const [tabId, group] of byTab) {
      await postDebug(DEBUG_LOG_PATH, { entries: group }, tabId);
    }
  }
}

/** Queue one entry for the backend debug run, keeping arrival order. */
export function sinkTrace(entry: TraceEntry): void {
  // The sidebar's Logs tab shows every trace, with or without backend capture.
  logTab(entry.tabId, LOG_KIND.event, `${entry.from} · ${entry.event}`, () => entry.data ?? {});
  if (!ACORN_CAPTURE) return;
  pending.push(entry);
  startFlush();
}

function startFlush(): void {
  if (flushing) return;
  flushing = flush().finally(() => {
    flushing = null;
    if (pending.length) startFlush();
  });
}

/** Wait until trace entries already queued have been sent. */
export async function flushDebugTraces(): Promise<void> {
  if (!ACORN_CAPTURE) return;
  while (pending.length > 0 || flushing) {
    startFlush();
    const current = flushing;
    if (!current) return;
    await current;
  }
}

/** Background code (pipeline, router): trace straight to the sink, filed under tabId's run. */
export function traceFromBackground(event: string, data?: TraceData, tabId?: number): void {
  sinkTrace({ t: Date.now(), from: "background", event, data: data?.(), tabId });
}
