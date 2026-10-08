/** Refill as a conversation: the plans a run already executed on one page, oldest first. */

import type { FieldIssueScan, FillMode } from "./field-issues";
import type { ActionPlan, RunStepRecord } from "./plan-runner/types";

/**
 * Plans kept per page. The run allows a fill and a few refills per page; older
 * turns than this add tokens, not insight.
 */
export const MAX_PLAN_TURNS = 4;

/**
 * One plan executed on the page and what came of it. A Refill sends the page's
 * turns so the planner continues from its own earlier answers: it sees which
 * value it typed, what the page said back, and what an earlier fix already tried.
 */
export interface PlanTurn {
  mode: FillMode;
  /** What the page flagged that asked for this plan; absent on the page's first fill. */
  fieldIssues?: FieldIssueScan;
  /** The plan as executed. Secrets are redacted (see redactPlan). */
  plan: ActionPlan;
  /** How each action went on the page. */
  steps: RunStepRecord[];
}

/** Appends a turn, keeping the first (the page's fill) and the most recent ones. */
export function appendPlanTurn(turns: PlanTurn[], turn: PlanTurn): PlanTurn[] {
  const next = [...turns, turn];
  if (next.length <= MAX_PLAN_TURNS) return next;
  return [next[0], ...next.slice(next.length - (MAX_PLAN_TURNS - 1))];
}
