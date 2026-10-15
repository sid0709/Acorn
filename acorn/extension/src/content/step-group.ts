/**
 * A step names a choice group (FormField.group) and must answer that group, not another
 * question that happens to share an option's words ("Yes" / "No" under two questions of
 * one section). These are the page-side checks: whether the control a step resolved to
 * belongs to the group, which option of the group the step means, and whether the group
 * holds an answer afterwards.
 */

import { inputOptionLabel } from "./agents/choice-group";
import { choiceGroupKey, groupMembers, normalize } from "./form-dom";
import { queryDeep } from "./query-deep";
import { isA } from "./realm";

/** A choice input (native radio or checkbox). */
function isChoiceInput(el: Element | null): el is HTMLInputElement {
  return isA(el, HTMLInputElement) && (el.type === "radio" || el.type === "checkbox");
}

/** The group a control is in, or null when it is not a native choice control. */
export function groupOf(el: Element | null): string | null {
  return isChoiceInput(el) ? choiceGroupKey(el) : null;
}

/** Whether the control is a choice control of a different group than the one expected. */
export function inWrongGroup(el: Element | null, expected: string | null | undefined): boolean {
  if (!expected) return false;
  const actual = groupOf(el);
  return actual != null && actual !== expected;
}

/**
 * The option of `expected` the step means: the group's own input whose label is the
 * intended value. Null when the group is not on the page or has no such option.
 */
export function optionOfGroup(
  expected: string,
  intended: string | null | undefined,
): HTMLInputElement | null {
  const inputs = queryDeep(document, 'input[type="radio"], input[type="checkbox"]').filter(
    (node): node is HTMLInputElement => isChoiceInput(node) && choiceGroupKey(node) === expected,
  );
  if (!inputs.length) return null;
  const want = normalize(intended ?? "");
  if (!want) return inputs[0];
  return (
    inputs.find((input) => normalize(inputOptionLabel(input)) === want) ??
    inputs.find((input) => normalize(input.value) === want) ??
    null
  );
}

/** Whether any option of the control's own group is chosen (a native radio group). */
export function groupHasAnswer(el: Element): boolean {
  if (!isChoiceInput(el)) return true;
  const members = groupMembers(el);
  // A lone box is a toggle: unchecked is one of its two answers (an entry that is not the
  // current job stays unchecked), never a question left unanswered.
  if (el.type === "checkbox" && members.length === 1) return true;
  return members.some((member) => (member as HTMLInputElement).checked);
}
