/**
 * A Run that ended with the application sent, as the record acorn-backend keeps for the
 * website's daily progress: the job's link, when it went in, how long the Run worked and
 * what the models cost. Built here from what the runner knows; completed-run-sync.ts keeps
 * it until acorn-backend has it.
 */

import {
  RUN_TITLE_MAX,
  RUN_URL_MAX,
  usdToNanos,
  type CompletedRunRecord,
} from "@acorn/shared/runs";

import type { AgentUsage } from "@acorn/shared/agent-contract";

/** The page a Run began on: the job's link. A continued Run keeps it, since it carries on from a later page. */
export interface JobPage {
  url: string;
  title: string;
}

/** What a Run that takes a stopped one back up carries over from the legs before it. */
export interface CarriedLegs {
  job: JobPage;
  /** How long the earlier legs worked (ms), and what the models cost in them (dollars). */
  workMs: number;
  costUsd: number;
}

/** The earlier legs of a continued Run (see KeptRun); nothing, for a Run that is new. */
export function carriedLegs(resume?: {
  job?: JobPage;
  workMs?: number;
  costUsd?: number;
}): CarriedLegs {
  return {
    job: resume?.job ?? { url: "", title: "" },
    workMs: resume?.workMs ?? 0,
    costUsd: resume?.costUsd ?? 0,
  };
}

/** The job's page: the one the first leg began on, else the page the tab is on as the Run starts. */
export function jobPageOf(known: JobPage, tab: { url?: string; title?: string }): JobPage {
  return known.url ? known : { url: tab.url ?? "", title: tab.title ?? "" };
}

/**
 * A page's address as a person can open it later: http or https, without the fragment or any
 * sign-in in it. The query stays, since many boards name the job there. An address that is
 * not one, or is too long to keep whole, is "".
 */
export function jobLink(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hash = "";
    url.username = "";
    url.password = "";
    if (url.href.length <= RUN_URL_MAX) return url.href;
    // Past the limit the query goes: a link to the page beats none.
    const bare = `${url.origin}${url.pathname}`;
    return bare.length <= RUN_URL_MAX ? bare : "";
  } catch {
    return "";
  }
}

/** A title on one line, cut to what a record keeps without splitting a character. */
export function jobTitle(raw: string): string {
  return Array.from(raw.trim().replace(/\s+/g, " ")).slice(0, RUN_TITLE_MAX).join("");
}

/**
 * How long a Run worked: the time of this leg added to what the legs before it took, less the
 * time it waited for the person's answers. The time a stopped Run sat before Continue was
 * pressed is in no leg.
 */
export function workedMs(input: {
  carriedMs: number;
  startedAt: number;
  endedAt: number;
  waitedOnPersonMs: number;
}): number {
  const { carriedMs, startedAt, endedAt, waitedOnPersonMs } = input;
  return Math.max(0, Math.round(carriedMs + (endedAt - startedAt) - waitedOnPersonMs));
}

/** Minutes east of UTC on this computer's clock at `at`: what the backend reads the day from. */
export function utcOffsetMinutesAt(at: number): number {
  return 0 - new Date(at).getTimezoneOffset();
}

export interface CompletedRunInput {
  runId: string;
  job: JobPage;
  /** When the application was confirmed sent (ms since epoch). */
  endedAt: number;
  workMs: number;
  /** What the models cost across the Run, in dollars (OpenRouter's own figure). */
  costUsd: number;
  steps: number;
  usage: AgentUsage | null;
}

/** The record for a Run that ended with the application sent. Its `recordId` is new. */
export function buildCompletedRun(input: CompletedRunInput): CompletedRunRecord {
  return {
    recordId: crypto.randomUUID(),
    runId: input.runId,
    url: jobLink(input.job.url),
    title: jobTitle(input.job.title),
    endedAt: input.endedAt,
    utcOffsetMinutes: utcOffsetMinutesAt(input.endedAt),
    durationMs: input.workMs,
    costNanos: usdToNanos(input.costUsd),
    steps: input.steps,
    modelCalls: input.usage?.calls ?? 0,
    screenChecks: input.usage?.checks ?? 0,
  };
}
