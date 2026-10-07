import { resolveElementByNodeId } from "./element-resolver";
import { fieldLabel, fieldWrapper, groupMembers } from "./form-dom";
import { associatedControl, labelCandidates } from "./verify/element-labels";
import { inferRole, roleMatches } from "./verify/element-role";
import { labelMatches } from "./verify/label-match";

export interface VerifyResult {
  ok: boolean;
  element: Element | null;
  matchedLabel?: string;
  matchedRole?: string;
  error?: string;
}

export function verifyElementByPlan(
  elementIndex: number,
  expectedLabel: string | null,
  expectedRole: string | null,
): VerifyResult {
  const resolved = resolveElementByNodeId(elementIndex);
  if (!resolved) {
    return {
      ok: false,
      element: null,
      error: `Element not found for index ${elementIndex}`,
    };
  }

  const el = associatedControl(resolved) ?? resolved;
  const matchedRole = inferRole(el);
  const candidates = [...labelCandidates(el), ...groupQuestionLabel(el)];
  const matchedLabel = candidates[0] || "";

  if (expectedRole && !roleMatches(expectedRole, matchedRole, el)) {
    return {
      ok: false,
      element: el,
      matchedLabel,
      matchedRole,
      error: `Role mismatch at ${elementIndex}: expected "${expectedRole}", got "${matchedRole}"`,
    };
  }

  if (expectedLabel && !labelMatches(expectedLabel, candidates)) {
    return {
      ok: false,
      element: el,
      matchedLabel,
      matchedRole,
      error: `Label mismatch at ${elementIndex}: expected "${expectedLabel}", got "${matchedLabel || "(none)"}"`,
    };
  }

  return {
    ok: true,
    element: el,
    matchedLabel,
    matchedRole,
  };
}

/**
 * A radio or checkbox names its option ("Yes"); the plan names the group's question,
 * read the same way the field scan reads it.
 */
function groupQuestionLabel(el: Element): string[] {
  if (!(el instanceof HTMLInputElement) || (el.type !== "radio" && el.type !== "checkbox"))
    return [];
  const members = groupMembers(el);
  if (members.length < 2) return [];
  const question = fieldLabel(el, members, fieldWrapper(el));
  return question ? [question] : [];
}

export function inferElementRole(el: Element): string {
  return inferRole(el);
}
