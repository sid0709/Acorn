import { authHeaders, getAcornApiUrl } from "../auth/acorn-auth";
import { ACORN_DEBUG, type TraceData, type TraceEntry } from "../debug-trace";

/** Entries sent per request; the rest wait for the next flush. */
const TRACE_BATCH_MAX = 50;

const pending: TraceEntry[] = [];
let flushing: Promise<void> | null = null;

async function flush(): Promise<void> {
  while (pending.length) {
    const entries = pending.splice(0, TRACE_BATCH_MAX);
    try {
      const base = (await getAcornApiUrl()).replace(/\/$/, "");
      await fetch(`${base}/acorn/debug/log`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ entries }),
      });
    } catch {
      // Debug capture is best effort; a missing route or session drops the batch.
    }
  }
}

/** Queue one entry for the backend debug run, keeping arrival order. */
export function sinkTrace(entry: TraceEntry): void {
  if (!ACORN_DEBUG) return;
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

/** Background code (pipeline, router): trace straight to the sink. */
export function traceFromBackground(event: string, data?: TraceData): void {
  if (!ACORN_DEBUG) return;
  sinkTrace({ t: Date.now(), from: "background", event, data: data?.() });
}
