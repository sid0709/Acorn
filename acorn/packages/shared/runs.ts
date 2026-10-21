/**
 * Runs that sent an application, kept per account for the website's daily progress. The
 * extension records one when a Run ends as completed (the page confirmed the application was
 * sent); the website reads them back. The extension, the website and acorn-backend's `runs`
 * package all agree on these shapes.
 */

import { NANOS_PER_USD } from "./tab-usage-ledger";

/** acorn-backend routes for completed Runs (the same paths for the extension and the website). */
export const ACORN_RUNS_API = {
  /** POST records a completed Run; GET lists the newest. */
  runs: "/acorn/runs",
  /** GET the Runs of each day from..to (`?from=YYYY-MM-DD&to=YYYY-MM-DD`), with their time and cost. */
  daily: "/acorn/runs/daily",
} as const;

/** What a record keeps of the page the Run started on; acorn-backend/runs holds the same bounds. */
export const RUN_URL_MAX = 2048;
export const RUN_TITLE_MAX = 200;

/** The most Runs one list read returns; acorn-backend/runs.MaxRecent. */
export const RUNS_RECENT_MAX = 100;
/** The longest span of days one daily read covers; acorn-backend/runs.MaxDailyDays. */
export const RUNS_DAILY_MAX_DAYS = 400;

/** What the extension sends when a Run ends with the application sent. */
export interface CompletedRunRecord {
  /** Made once per record and kept until it is stored: sending it again counts once. */
  recordId: string;
  /** The Run's id in the Logs tab. */
  runId: string;
  /** The page the Run started on, the link of the job. */
  url: string;
  title: string;
  /** When the application was confirmed sent (ms since epoch). */
  endedAt: number;
  /** The person's clock at `endedAt`, minutes east of UTC: the day the Run counts for is the day on it. */
  utcOffsetMinutes: number;
  /** How long the Run worked (ms): continued legs added, the time it waited on the person left out. */
  durationMs: number;
  /** What the models cost, in nanodollars (like `costNanos` of an AI usage row). */
  costNanos: number;
  steps: number;
  modelCalls: number;
  screenChecks: number;
}

/** A completed Run as the website reads it. */
export type CompletedRun = {
  id: string;
  runId: string;
  /** The job's link; empty when the page's address was not one a person can open. */
  url: string;
  title: string;
  /** The calendar day on the person's clock when it ended (`YYYY-MM-DD`), and the minutes after midnight on it. */
  day: string;
  minute: number;
  /** ms since epoch. */
  endedAt: number;
  durationMs: number;
  costNanos: number;
  steps: number;
  modelCalls: number;
  screenChecks: number;
};

/** The Runs of one calendar day, summed. */
export type RunDay = {
  day: string;
  count: number;
  durationMs: number;
  costNanos: number;
};

/** Dollars (OpenRouter's own figure for a run) as the nanodollars a record carries. */
export function usdToNanos(usd: number): number {
  return Number.isFinite(usd) && usd > 0 ? Math.round(usd * NANOS_PER_USD) : 0;
}

export function nanosToUsd(nanos: number): number {
  return nanos / NANOS_PER_USD;
}
