import { traceFromBackground } from "../background/debug-trace-sink";
import { LOG_KIND, LOG_LEVEL, logTab, setRunContext, type LogLevel } from "../tab-log-session";

/** A page address without its query or fragment, which can carry tokens. */
export function logUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname}`;
  } catch {
    return "";
  }
}

/** Events that mean the run was refused, missed, or gave up: the Logs tab marks them. */
const WARN_EVENT =
  /(^run:stop|:failed|:missed|:rejected|:refused|:lost|:stalled|:spent|no-effect|blocked)/;
const ERROR_EVENT = /^(diagnose:failed|account:judge-failed)/;

/** How serious an event is, from its name. */
export function levelOfEvent(event: string): LogLevel {
  if (ERROR_EVENT.test(event)) return LOG_LEVEL.error;
  if (WARN_EVENT.test(event)) return LOG_LEVEL.warn;
  return LOG_LEVEL.info;
}

/**
 * One run's timeline, written to the tab's log. Every event carries the run, its
 * step and page, so the Logs tab reads as one story. Events name labels and counts,
 * never field values. Nothing here is sent anywhere: the log stays in the browser
 * until the person submits a support report.
 */
export class RunLog {
  step = 0;
  page = 0;

  constructor(
    readonly runId: string,
    private tabId: number,
  ) {
    setRunContext(tabId, { runId, step: 0, page: 0 });
  }

  /** The run went on in another tab: its events are that tab's from now on. */
  moveTo(tabId: number): void {
    this.tabId = tabId;
    setRunContext(tabId, { runId: this.runId, step: this.step, page: this.page });
  }

  event(event: string, data?: Record<string, unknown>): void {
    console.info("[acorn:run]", this.runId, `#${this.step}`, event, data ?? "");
    if (event === "page" && typeof data?.page === "number") this.page = data.page;
    setRunContext(this.tabId, { runId: this.runId, step: this.step, page: this.page });
    traceFromBackground(
      `run:${event}`,
      () => ({ runId: this.runId, step: this.step, ...data }),
      this.tabId,
      { level: levelOfEvent(event) },
    );
    // The run is over: later entries on the tab (the page's own traces) are not its.
    if (event === "run:end") setRunContext(this.tabId, null);
  }

  /**
   * A choice the run made, or refused to make, and what it rested on: the Logs tab
   * shows these so a stop or a wait can be explained from the log alone. `evidence`
   * is what the run saw when it chose (the model's answer, the counts, the lines).
   */
  decision(
    what: string,
    why: string,
    evidence?: Record<string, unknown>,
    level: LogLevel = LOG_LEVEL.info,
  ): void {
    console.info("[acorn:run]", this.runId, `#${this.step}`, `decision: ${what} — ${why}`);
    setRunContext(this.tabId, { runId: this.runId, step: this.step, page: this.page });
    logTab(this.tabId, LOG_KIND.decision, what, () => ({ what, why, evidence }), { level });
  }

  /** Kept for callers that waited on an upload; the log is written locally as it goes. */
  async flush(): Promise<void> {}
}
