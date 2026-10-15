/** Refill as a conversation: the plans a run already executed on one page, oldest first. */

import type { FieldIssueScan, FillMode } from "./field-issues";
import type { FieldAttempt, FormField } from "./form-fields";
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

/** A field's identity across reads of the page: its choice group, else its question. */
export function fieldKey(field: { group?: string | null; label: string | null }): string {
  return field.group
    ? `group:${field.group}`
    : `label:${(field.label ?? "").replace(/\s+/g, " ").trim().toLowerCase()}`;
}

/**
 * What earlier rounds did to each field, by identity: every answer a step gave it and
 * how the step went. A field the page still flags after an answer was already
 * answered once; planning it the same way again repeats the answer and the step.
 */
export function attemptsByField(turns: readonly PlanTurn[]): Map<string, FieldAttempt[]> {
  const byField = new Map<string, FieldAttempt[]>();
  for (const turn of turns) {
    for (const step of turn.steps) {
      const action = turn.plan.actions?.[step.index];
      if (!action || action.value == null || action.value === "") continue;
      if (step.status === "pending" || step.status === "running") continue;
      const key = fieldKey({ group: action.expected_group, label: action.expected_label });
      const result = step.message ? `${step.status}: ${step.message}` : step.status;
      byField.set(key, [...(byField.get(key) ?? []), { value: action.value, result }]);
    }
  }
  return byField;
}

/**
 * The flagged fields, each carrying the answers earlier refill rounds gave it (none
 * for a field no refill touched before): the request's way of saying "this was tried".
 */
export function withAttempts(
  fields: readonly FormField[] | null | undefined,
  turns: readonly PlanTurn[] | null | undefined,
): FormField[] | undefined {
  if (!fields) return undefined;
  // Only rounds that were already fixing something count: the page's first fill
  // answering a field is how it came to be flagged, not an attempt to fix it.
  const fixes = (turns ?? []).filter((turn) => turn.mode === "refill");
  if (!fixes.length) return [...fields];
  const tried = attemptsByField(fixes);
  return fields.map((field) => {
    const attempts = tried.get(fieldKey(field));
    return attempts?.length && field.issue
      ? { ...field, issue: { ...field.issue, attempts } }
      : field;
  });
}

/**
 * The fields a page still needs, each with what was tried on it: "Will you require
 * sponsorship? (tried "Yes", then "No"; the page still flags it)". A field no step
 * touched is named alone. Used to say, when the run gives up, what it did.
 */
export function describeNeeds(needs: readonly string[], turns: readonly PlanTurn[]): string[] {
  const byLabel = new Map<string, string[]>();
  for (const turn of turns) {
    for (const step of turn.steps) {
      const action = turn.plan.actions?.[step.index];
      if (!action || action.value == null || action.value === "") continue;
      if (step.status === "pending" || step.status === "running") continue;
      const key = fieldKey({ label: action.expected_label });
      byLabel.set(key, [...(byLabel.get(key) ?? []), action.value]);
    }
  }
  return needs.map((need) => {
    const tried = byLabel.get(fieldKey({ label: need }));
    return tried?.length
      ? `${need} (tried ${tried.map((value) => `"${value}"`).join(", then ")}; the page still flags it)`
      : need;
  });
}

/** A required field the fill could not answer, and the reason it was left to the person. */
export type UnansweredField = { label: string; reason: string };

/**
 * The required fields the page's fill could not answer: their question was never on the
 * page, or they ask for a document the applicant does not have. Sending the form would
 * leave them empty or wrong, so the run stops and says which and why. Read from the fill
 * rounds' plans; a refill does not make a field answerable.
 */
export function requiredUnanswerable(turns: readonly PlanTurn[]): UnansweredField[] {
  const found = new Map<string, UnansweredField>();
  for (const turn of turns) {
    if (turn.mode !== "fill") continue;
    for (const field of turn.plan.unanswerable ?? []) {
      found.set(field.label, { label: field.label, reason: field.reason });
    }
  }
  return [...found.values()];
}
