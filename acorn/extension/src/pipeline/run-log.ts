import { authHeaders, getAcornApiUrl } from "../auth/acorn-auth";
import { captureDebugHtml } from "../background/debug-html";
import { queueDebugShot } from "../background/debug-shot";
import { traceFromBackground } from "../background/debug-trace-sink";

import { RUN_LOG_BATCH_MAX, RUN_LOG_FLUSH_MS } from "./run-limits";

/**
 * These pause for a stitched full-page image. The caller awaits `screenshot`
 * before the run touches the page again, so the scroll-and-restore does not
 * land under a click. Every other event stores a viewport shot, debounced.
 * "page" is not here: the stitch takes tens of seconds on a long page and it
 * would hold up the first read of every page.
 */
const FULL_PAGE_SHOTS = new Set(["fill:done", "refill:done", "run:end"]);

type RunLogEvent = { t: number; step: number; event: string; data?: Record<string, unknown> };

/** A page address without its query or fragment, which can carry tokens. */
export function logUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname}`;
  } catch {
    return "";
  }
}

/**
 * One run's timeline. Every event is logged in the service worker and sent to the
 * backend, which writes it next to its own decisions under the same run id. Events
 * name labels and counts, never field values.
 */
export class RunLog {
  private pending: RunLogEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending: Promise<void> = Promise.resolve();
  step = 0;

  constructor(
    readonly runId: string,
    private readonly tabId: number,
  ) {}

  event(event: string, data?: Record<string, unknown>): void {
    console.info("[acorn:run]", this.runId, `#${this.step}`, event, data ?? "");
    traceFromBackground(
      `run:${event}`,
      () => ({ runId: this.runId, step: this.step, ...data }),
      this.tabId,
    );
    if (!FULL_PAGE_SHOTS.has(event)) void queueDebugShot(this.tabId, event, false);
    this.pending.push({ t: Date.now(), step: this.step, event, data });
    if (this.pending.length >= RUN_LOG_BATCH_MAX) {
      void this.flush();
      return;
    }
    this.timer ??= setTimeout(() => void this.flush(), RUN_LOG_FLUSH_MS);
  }

  /**
   * A screenshot for a moment the run is standing still, with the page's HTML
   * (and that of the frame the run reads) next to it. Only the labels in
   * FULL_PAGE_SHOTS stitch the whole page; any other is one viewport shot.
   */
  screenshot(label: string, frameId?: number | null): Promise<void> {
    void captureDebugHtml(this.tabId, label, frameId);
    return queueDebugShot(this.tabId, label, FULL_PAGE_SHOTS.has(label));
  }

  /** Send what is queued and wait for it. Called when the run ends. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.pending.splice(0, RUN_LOG_BATCH_MAX);
    if (batch.length) this.sending = this.sending.then(() => this.send(batch));
    if (this.pending.length) return this.flush();
    return this.sending;
  }

  private async send(events: RunLogEvent[]): Promise<void> {
    try {
      const base = (await getAcornApiUrl()).replace(/\/$/, "");
      await fetch(`${base}/acorn/run/log`, {
        method: "POST",
        headers: await authHeaders(this.tabId),
        body: JSON.stringify({ runId: this.runId, events }),
      });
    } catch {
      // The log is best effort; a lost batch never stops a run.
    }
  }
}
