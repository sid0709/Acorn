/**
 * What a tab's log says at a glance, for the downloaded zip and for a support
 * report: each run with how it ended and how long its parts took, and the entries
 * that were problems. Built from the entries alone, so the log is the whole record.
 */

import type { TabLogEntry } from "./tab-log-session";

/** The log entry a run's closing event is written as (`from · run:` + event name `run:end`). */
const RUN_END_TITLE = /run:run:end$/;
const RUN_START_TITLE = /run:run:start$/;
const AGENT_STEP_TITLE = /run:agent-step$/;
/** How many of a run's slowest steps the summary lists. */
const SLOWEST_STEPS = 5;

/** Where one agent step's time went: the look, the request (server against network) and the actions before it. */
export type StepTiming = {
  step: number;
  /** When the step's look began (unix ms). */
  at?: number;
  /** Look + request, in ms: the step's own time, not counting the actions that follow it. */
  totalMs: number;
  lookMs?: number;
  askMs?: number;
  serverMs?: number;
  networkMs?: number;
  actionsMs?: number;
  /** The look's parts, by name, in ms. */
  lookLaps?: Record<string, number>;
  hidden?: boolean;
};

export type LogRunSummary = {
  runId: string;
  startedAt: number;
  lastAt: number;
  /** How the run ended; "unfinished" when its closing event was never written. */
  outcome: string;
  reason?: string;
  detail?: string;
  seconds?: number;
  pages?: number;
  refills?: number;
  calls?: number;
  costUsd?: number;
  /** Milliseconds per phase of the run, as the run reported them. */
  phases?: Record<string, number>;
  /** The run's slowest agent steps, slowest first, each with where its time went. */
  slowestSteps?: StepTiming[];
  entries: number;
  warnings: number;
  errors: number;
  /** The title of the last warning or error of the run. */
  lastProblem?: string;
};

export type LogSummary = {
  extensionVersion: string;
  generatedAt: number;
  entries: number;
  warnings: number;
  errors: number;
  runs: LogRunSummary[];
};

function dataOf(entry: TabLogEntry): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(entry.text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function summarizeLog(
  entries: readonly TabLogEntry[],
  extensionVersion: string,
  generatedAt = Date.now(),
): LogSummary {
  const byRun = new Map<string, LogRunSummary>();
  const steps = new Map<string, StepTiming[]>();
  let warnings = 0;
  let errors = 0;
  for (const entry of entries) {
    if (entry.level === "warn") warnings += 1;
    if (entry.level === "error") errors += 1;
    if (!entry.runId) continue;
    let run = byRun.get(entry.runId);
    if (!run) {
      run = {
        runId: entry.runId,
        startedAt: entry.t,
        lastAt: entry.t,
        outcome: "unfinished",
        entries: 0,
        warnings: 0,
        errors: 0,
      };
      byRun.set(entry.runId, run);
    }
    run.entries += 1;
    run.startedAt = Math.min(run.startedAt, entry.t);
    run.lastAt = Math.max(run.lastAt, entry.t);
    if (entry.level === "warn" || entry.level === "error") {
      if (entry.level === "warn") run.warnings += 1;
      else run.errors += 1;
      run.lastProblem = entry.title;
    }
    if (RUN_START_TITLE.test(entry.title)) run.startedAt = entry.t;
    if (AGENT_STEP_TITLE.test(entry.title)) {
      const data = dataOf(entry);
      const lookMs = count(data.lookMs);
      const askMs = count(data.ms);
      const step = count(data.step) ?? entry.step ?? 0;
      (steps.get(entry.runId) ?? steps.set(entry.runId, []).get(entry.runId))?.push({
        step,
        at: count(data.lookStartedAt),
        totalMs: (lookMs ?? 0) + (askMs ?? 0),
        lookMs,
        askMs,
        serverMs: count(data.serverMs),
        networkMs: count(data.networkMs),
        actionsMs: count(data.actionsMs),
        lookLaps:
          data.lookLaps && typeof data.lookLaps === "object"
            ? (data.lookLaps as Record<string, number>)
            : undefined,
        hidden: typeof data.hidden === "boolean" ? data.hidden : undefined,
      });
    }
    if (RUN_END_TITLE.test(entry.title)) {
      const data = dataOf(entry);
      run.outcome = text(data.outcome) ?? "ended";
      run.reason = text(data.reason);
      run.detail = text(data.detail);
      run.seconds = count(data.seconds);
      run.pages = count(data.pages);
      run.refills = count(data.refills);
      run.calls = count(data.calls);
      run.costUsd = count(data.costUsd);
      if (data.phases && typeof data.phases === "object") {
        run.phases = data.phases as Record<string, number>;
      }
    }
  }
  for (const [runId, timings] of steps) {
    const run = byRun.get(runId);
    if (run)
      run.slowestSteps = timings.sort((a, b) => b.totalMs - a.totalMs).slice(0, SLOWEST_STEPS);
  }
  return {
    extensionVersion,
    generatedAt,
    entries: entries.length,
    warnings,
    errors,
    runs: [...byRun.values()].sort((a, b) => a.startedAt - b.startedAt),
  };
}

/** One line per entry for the zip's index: where to find it and what it belongs to. */
export type LogIndexRow = {
  file: string;
  t: number;
  kind: string;
  level?: string;
  title: string;
  runId?: string;
  step?: number;
  page?: number;
  ms?: number;
  group?: string;
};

export function logIndex(entries: readonly TabLogEntry[], files: readonly string[]): LogIndexRow[] {
  return entries.map((entry, i) => ({
    file: files[i] ?? "",
    t: entry.t,
    kind: entry.kind,
    level: entry.level,
    title: entry.title,
    runId: entry.runId,
    step: entry.step,
    page: entry.page,
    ms: entry.ms,
    group: entry.group,
  }));
}
