/** Run: one click that recommends, fills, advances, and refills until the application is done. */

import type { AiUsageSummary } from "./ai-usage";

/** What the orchestrator is doing right now. */
export const RUN_STAGE = {
  reading: "reading",
  recommending: "recommending",
  applying: "applying",
  filling: "filling",
  advancing: "advancing",
  refilling: "refilling",
  diagnosing: "diagnosing",
} as const;

export type RunStage = (typeof RUN_STAGE)[keyof typeof RUN_STAGE];

/** What kind of page the decision model says this is (mirrors the backend's page kinds). */
export const PAGE_KIND = {
  posting: "job_posting",
  form: "application_form",
  confirmation: "confirmation",
  blocked: "blocked",
  other: "other",
} as const;

export type PageKind = (typeof PAGE_KIND)[keyof typeof PAGE_KIND];

/** What a picked control does (mirrors the backend's roles). */
export const CONTROL_ROLE = {
  apply: "apply",
  next: "next",
  submit: "submit",
} as const;

export type ControlRole = (typeof CONTROL_ROLE)[keyof typeof CONTROL_ROLE];

/** How a run ended. */
export const RUN_OUTCOME = {
  completed: "completed",
  failed: "failed",
} as const;

export type RunOutcome = (typeof RUN_OUTCOME)[keyof typeof RUN_OUTCOME];

/** Why a run could not finish, in the decision model's words (mirrors the backend's reasons). */
export interface RunFailure {
  reason: string;
  label: string;
  /** The page's own words behind the reason: flagged fields, alerts, failed steps. */
  detail: string;
  stage: RunStage;
}

export interface RunReport {
  outcome: RunOutcome;
  /** Pages the run moved through, counting the first. */
  pages: number;
  /** Refill rounds spent across the whole run. */
  refills: number;
  failure?: RunFailure;
  /** Decision-model cost of the Run's own decisions (page reads and diagnosis). */
  usage?: AiUsageSummary | null;
}

/** Live Run state shown in the sidebar. */
export interface RunProgress {
  runId: string;
  stage: RunStage;
  /** 1-based count of pages visited. */
  page: number;
  /** Refill rounds spent on the current page, and the most a page gets. */
  refills: number;
  maxRefills: number;
  /** The kind the decision model gave the current page. */
  kind?: PageKind;
  /** What the run is about to click, or just clicked. */
  control?: string;
  report?: RunReport;
}
