/**
 * Fields still unanswered after a plan ran: on the page now, never touched by a
 * plan step, and holding no value. Pages render parts of a form late (a section
 * that loads after the first scan, fields an import fills in, follow-up questions
 * an answer reveals), so the first scan cannot have planned them.
 */

import { flaggedFields, type FieldIssueScan } from "@acorn/shared/field-issues";

import { isChoiceSelected } from "./agents/choice-state";
import { wasGroupAnswered, wasPlanFilled } from "./agents/plan-fill-registry";
import { readControlValue } from "./agents/read-control-value";
import { groupRoot } from "./agents/select-radio";
import { uploadedAny } from "./agents/upload-registry";
import { resolveElementByNodeId } from "./element-resolver";
import { choiceGroupKey, fieldWrapper, groupMembers, isVisible } from "./form-dom";
import { BUTTON_SELECTOR, scanFormFields } from "./form-fields";
import { scopeTest } from "./scope";

import type { FormField } from "@acorn/shared/form-fields";

function answered(field: FormField, control: Element): boolean {
  switch (field.kind) {
    case "radio":
    case "checkbox":
      // A group the page drew again keeps its answer though its hidden inputs reset.
      return (
        groupMembers(control).some(isChoiceSelected) || wasGroupAnswered(choiceGroupKey(control))
      );
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
 * Fields to plan in a late pass. Uploads are planned only while none went up. When the page keeps
 * its forward control disabled (`blocked`), a box the plan chose to leave off is
 * asked about again, marked as possibly what the page is waiting for. `scope`
 * keeps only the fields of what a click opened (see scope.ts); an upload it asks
 * for is its own, so it is planned whatever went up elsewhere.
 */
export function scanPendingFormFields(
  opts: { blocked?: boolean; scope?: ((el: Element) => boolean) | null } = {},
): FormField[] {
  const pending = scanFormFields().filter((field) => {
    const control = resolveElementByNodeId(field.elementIndex);
    if (opts.scope && (!control || !opts.scope(control))) return false;
    // An upload is planned again only while nothing went up through this document:
    // a form drawn behind a dialog at the first look still gets its résumé, and a
    // file is never sent twice.
    if (field.kind === "file")
      return (
        (opts.scope != null || !uploadedAny()) && Boolean(control) && !readControlValue(control)
      );
    // The field's own box: a follow-up an answer hid again is gone; a hidden proxy input is not.
    if (!control || !isVisible(fieldWrapper(control))) return false;
    if (opts.blocked && field.kind === "toggle") return toggleOff(control);
    return !wasPlanFilled(control) && !answered(field, control);
  });
  return opts.blocked ? pending.map((field) => ({ ...field, blocking: true })) : pending;
}

/**
 * The fields the page flags, each with what the page shows about it (Refill). A
 * field answers an issue when the page flags its own control, another box of its
 * group, or the hidden box behind its Yes/No buttons. An issue no field answers (a
 * custom dropdown) is left to the runtime's dropdown pass.
 */
function scanFlaggedFormFields(
  scan: FieldIssueScan,
  scope: ((el: Element) => boolean) | null,
): FormField[] {
  const controls = new Map<number, Element | null>();
  const control = (id: number) => {
    if (!controls.has(id)) controls.set(id, resolveElementByNodeId(id));
    return controls.get(id) ?? null;
  };
  const groups = new Map<number, Element[]>();
  const group = (id: number, flagged: Element) => {
    if (!groups.has(id)) groups.set(id, groupMembers(flagged));
    return groups.get(id) ?? [];
  };
  const fields = scanFormFields().filter((field) => {
    const own = control(field.elementIndex);
    return own != null && (!scope || scope(own));
  });
  return flaggedFields(fields, scan, (field, issue) => {
    const own = control(field.elementIndex);
    const flagged = control(issue.elementIndex);
    if (!own || !flagged) return field.elementIndex === issue.elementIndex;
    if (own === flagged || group(issue.elementIndex, flagged).includes(own)) return true;
    // A Yes/No field of buttons is listed by its first button; the page flags the box behind them.
    return field.kind === "buttons" && fieldWrapper(flagged).contains(own);
  });
}

/**
 * The fields a fill plans: all of them, only those still unanswered (`pending`),
 * or only those the page flags (`flagged`, a Refill). `scoped` keeps only what the
 * run's last opening click drew; with no scope open it is none, so a scoped fill
 * never spills onto the rest of the page.
 */
export function readFormFields(opts: {
  pending: boolean;
  blocked: boolean;
  scoped: boolean;
  /** Refill: the page's issues, read in the same pass; only the fields they name are listed. */
  flagged?: FieldIssueScan | null;
}): FormField[] {
  const scope = opts.scoped ? scopeTest() : null;
  if (opts.scoped && !scope) return [];
  if (opts.flagged) return scanFlaggedFormFields(opts.flagged, scope);
  if (opts.pending) return scanPendingFormFields({ blocked: opts.blocked, scope });
  const fields = scanFormFields();
  if (!scope) return fields;
  return fields.filter((field) => {
    const control = resolveElementByNodeId(field.elementIndex);
    return control != null && scope(control);
  });
}
