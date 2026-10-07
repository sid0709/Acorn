/**
 * Fields still unanswered after a plan ran: on the page now, never touched by a
 * plan step, and holding no value. Pages render parts of a form late (a section
 * that loads after the first scan, fields an import fills in, follow-up questions
 * an answer reveals), so the first scan cannot have planned them.
 */

import { isChoiceSelected } from "./agents/choice-state";
import { wasPlanFilled } from "./agents/plan-fill-registry";
import { readControlValue } from "./agents/read-control-value";
import { groupRoot } from "./agents/select-radio";
import { resolveElementByNodeId } from "./element-resolver";
import { fieldWrapper, groupMembers, isVisible } from "./form-dom";
import { BUTTON_SELECTOR, scanFormFields } from "./form-fields";

import type { FormField } from "@acorn/shared/form-fields";

function answered(field: FormField, control: Element): boolean {
  switch (field.kind) {
    case "radio":
    case "checkbox":
      return groupMembers(control).some(isChoiceSelected);
    case "buttons":
      return Array.from(groupRoot(control as HTMLElement).querySelectorAll(BUTTON_SELECTOR)).some(
        isChoiceSelected,
      );
    // Unchecked is a box's resting state, not an answer: only a plan step answers it.
    case "toggle":
      return false;
    default:
      return Boolean(readControlValue(control));
  }
}

/** A single box that is off now, whoever left it so. */
function toggleOff(control: Element): boolean {
  if (control instanceof HTMLInputElement) return !control.checked;
  return control.getAttribute("aria-checked") !== "true";
}

/**
 * Fields to plan in a late pass. Uploads are never repeated. When the page keeps
 * its forward control disabled (`blocked`), a box the plan chose to leave off is
 * asked about again, marked as possibly what the page is waiting for.
 */
export function scanPendingFormFields(opts: { blocked?: boolean } = {}): FormField[] {
  const pending = scanFormFields().filter((field) => {
    if (field.kind === "file") return false;
    const control = resolveElementByNodeId(field.elementIndex);
    // The field's own box: a follow-up an answer hid again is gone; a hidden proxy input is not.
    if (!control || !isVisible(fieldWrapper(control))) return false;
    if (opts.blocked && field.kind === "toggle") return toggleOff(control);
    return !wasPlanFilled(control) && !answered(field, control);
  });
  return opts.blocked ? pending.map((field) => ({ ...field, blocking: true })) : pending;
}
