/**
 * Secrets on a page (the account password in a password box) never leave it:
 * plans, trees, field reports, and traces show HIDDEN_VALUE in their place.
 */

import type { ActionPlan, PlanAction } from "./plan-runner/types";

/** Stands in for a secret value anywhere it would be shown, logged, or sent. */
export const HIDDEN_VALUE = "(hidden)";

/** The input type a browser masks. */
export const PASSWORD_INPUT_TYPE = "password";

/** Plan role of a fill into a password box (mirrors the backend's rolePassword). */
export const PASSWORD_ROLE = "password";

/** A control whose value must not leave the page. */
export function isSecretControl(el: Element | null | undefined): boolean {
  return el instanceof HTMLInputElement && (el.type || "").toLowerCase() === PASSWORD_INPUT_TYPE;
}

/** The value as it may be shown: HIDDEN_VALUE for a secret control that holds one. */
export function shownValue<T extends string | null | undefined>(
  el: Element | null | undefined,
  value: T,
): T | typeof HIDDEN_VALUE {
  return value && isSecretControl(el) ? HIDDEN_VALUE : value;
}

function isSecretAction(action: PlanAction): boolean {
  return (
    action.action === "fill" &&
    (action.expected_role ?? "")
      .trim()
      .toLowerCase()
      .split(/[\s,/|:]+/)[0] === PASSWORD_ROLE
  );
}

/** A copy of the plan with every password fill's value hidden, for display and progress. */
export function redactPlan(plan: ActionPlan): ActionPlan {
  if (!plan.actions?.some(isSecretAction)) return plan;
  return {
    ...plan,
    actions: plan.actions.map((action) =>
      isSecretAction(action) ? { ...action, value: HIDDEN_VALUE } : action,
    ),
  };
}
