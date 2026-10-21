import { formatDuration, formatUsd } from "@acorn/shared/ai-usage";
import { nanosToUsd, type CompletedRun, type RunDay } from "@acorn/shared/runs";
import type { HeatmapDay, KpiDelta } from "sid-ui";

import { addDays, daysBetween, formatDay, type Day } from "./dates";
import {
  RANGES,
  habits,
  previousWindow,
  windowFor,
  within,
  type RangeValue,
  type Window,
} from "./stats";

/**
 * Daily progress: the applications Acorn sent for the signed-in person, counted from the Runs
 * acorn-backend keeps (acorn/packages/shared/runs.ts). These are real numbers; the rest of
 * Statistics is sample data until replies are tracked.
 */

const LONGEST_RANGE_DAYS = Math.max(...RANGES.map((range) => Number(range.value)));

/** Days of history the page loads: the longest range, and as many again before it for the deltas. */
export const PROGRESS_HISTORY_DAYS = 2 * LONGEST_RANGE_DAYS;

/** The newest applications the table lists. */
export const RECENT_RUNS = 24;

/** What the page loads from acorn-backend: the days, and the newest applications; or why it could not. */
export type RunProgressData =
  { ok: true; days: RunDay[]; recent: CompletedRun[] } | { ok: false; message: string };

/**
 * The days to ask acorn-backend for. A day on either side of the server's today is included,
 * since the person's today need not be the server's.
 */
export function historyWindow(today: Day): Window {
  return { from: addDays(today, -PROGRESS_HISTORY_DAYS), to: addDays(today, 1) };
}

/** One entry per day in the window, days with no application included, so a chart has no holes. */
export function fillDays(days: RunDay[], window: Window): RunDay[] {
  const held = new Map(days.map((entry) => [entry.day, entry]));
  const length = daysBetween(window.from, window.to) + 1;
  return Array.from({ length }, (_, index) => {
    const day = addDays(window.from, index);
    return held.get(day) ?? { day, count: 0, durationMs: 0, costNanos: 0 };
  });
}

export type ProgressSummary = {
  sent: number;
  /** Days in the window with at least one application. */
  activeDays: number;
  durationMs: number;
  costNanos: number;
  /** What one application took and cost on average; null with none. */
  avgDurationMs: number | null;
  avgCostNanos: number | null;
};

export function summarizeProgress(days: RunDay[], window: Window): ProgressSummary {
  let sent = 0;
  let activeDays = 0;
  let durationMs = 0;
  let costNanos = 0;
  for (const entry of days) {
    if (!within(entry.day, window) || entry.count <= 0) continue;
    sent += entry.count;
    activeDays += 1;
    durationMs += entry.durationMs;
    costNanos += entry.costNanos;
  }
  return {
    sent,
    activeDays,
    durationMs,
    costNanos,
    avgDurationMs: sent ? durationMs / sent : null,
    avgCostNanos: sent ? costNanos / sent : null,
  };
}

export type DailyProgress = {
  /** One per day of the selected range, oldest first: for the chart. */
  labels: string[];
  counts: number[];
  current: ProgressSummary;
  previous: ProgressSummary;
  sentToday: number;
  sentYesterday: number;
  /** The most days in a row, within the range, that held an application. */
  bestStreak: number;
  /** Whether any application was counted in the days loaded, whatever the range. */
  hasAny: boolean;
};

/** Everything the Daily progress section shows for one range, from the days acorn-backend sent. */
export function dailyProgress(days: RunDay[], today: Day, range: RangeValue): DailyProgress {
  const period = windowFor(range, today);
  const points = fillDays(days, period);
  const heat: HeatmapDay[] = points.map((point) => ({ date: point.day, value: point.count }));
  const counts = new Map(days.map((entry) => [entry.day, entry.count]));
  return {
    labels: points.map((point) => formatDay(point.day)),
    counts: points.map((point) => point.count),
    current: summarizeProgress(days, period),
    previous: summarizeProgress(days, previousWindow(period)),
    sentToday: counts.get(today) ?? 0,
    sentYesterday: counts.get(addDays(today, -1)) ?? 0,
    bestStreak: habits(heat).bestStreak,
    hasAny: days.some((entry) => entry.count > 0),
  };
}

/** The change from `previous` to `current` as a count ("+2"): for numbers too small for a percentage to mean much. */
export function countChange(current: number, previous: number): KpiDelta {
  const change = current - previous;
  if (change === 0) return { value: "0", direction: "flat" };
  return {
    value: `${change > 0 ? "+" : "−"}${Math.abs(change)}`,
    direction: change > 0 ? "up" : "down",
  };
}

/** Dollars, from the nanodollars acorn-backend keeps money in. */
export function formatCost(nanos: number): string {
  return formatUsd(nanosToUsd(nanos));
}

/** How long a Run worked, "1m 33s"; "—" when there is no Run to average. */
export function formatWorked(ms: number | null): string {
  return ms === null ? "—" : formatDuration(ms);
}

/** The most characters of a job's address the table shows; the rest is cut. */
const WHERE_MAX = 64;

export type RunLabel = {
  /** What the job is called: its title, else the site it is on. */
  title: string;
  /** Where it is, without the query: the host and the path. */
  where: string;
  /** The link to open it; null when the address is not a web page a person can open. */
  href: string | null;
};

/** What the table shows for a Run's job. Only an http or https address becomes a link. */
export function describeRun(run: Pick<CompletedRun, "url" | "title">): RunLabel {
  try {
    const url = new URL(run.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("not a web page");
    const path = url.pathname === "/" ? "" : url.pathname;
    const where = `${url.host}${path}`;
    return {
      title: run.title || url.host,
      where: where.length > WHERE_MAX ? `${where.slice(0, WHERE_MAX - 1)}…` : where,
      href: url.href,
    };
  } catch {
    return { title: run.title || "Untitled job", where: "", href: null };
  }
}
