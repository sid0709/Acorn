/**
 * Entering an emailed code needs no model: the run holds the code, and the page's
 * own structure says where it goes. Structural rules only, no site or wording.
 */

import type { FormField } from "../form-fields";
import type { PlanAction } from "./types";

/** Input types that take typed characters; anything else is not a code box. */
const CODE_INPUT_TYPES = new Set(["", "text", "tel", "number", "password"]);

/** The plan's expected role for a typed text box. */
const TEXT_ROLE = "textbox";

function fillAction(field: FormField, value: string): PlanAction {
  return {
    action: "fill",
    element_index: field.elementIndex,
    element_indexes: null,
    expected_label: field.label,
    expected_role: TEXT_ROLE,
    value,
    file: null,
    reason: null,
    ms: null,
  };
}

/** The boxes the page needs typed: the required text fields, in page order. */
function requiredTextBoxes(fields: readonly FormField[]): FormField[] {
  return fields.filter(
    (field) =>
      field.kind === "text" &&
      field.required &&
      CODE_INPUT_TYPES.has((field.inputType ?? "").toLowerCase()),
  );
}

/**
 * The code written out without a planner call, when the page's required text boxes
 * are exactly the code's: one box takes the whole code, one box per character takes
 * one character each. Null when the page asks for anything else too, or a box is
 * too short for what it must hold, so the planner reads the page.
 */
export function planCodeFill(fields: readonly FormField[], code: string): PlanAction[] | null {
  if (!code) return null;
  // A page whose whole form is on screen holds its forward control disabled until the
  // code is in: the boxes it is waiting on are the code's, whatever else it requires.
  const waitedOn = requiredTextBoxes(fields).filter((field) => field.blocking);
  const boxes =
    waitedOn.length === 1 || waitedOn.length === code.length ? waitedOn : requiredTextBoxes(fields);
  if (boxes.length === 1) {
    const [box] = boxes;
    if (box.maxLength != null && box.maxLength < code.length) return null;
    return [fillAction(box, code)];
  }
  if (boxes.length === code.length) {
    const chars = Array.from(code);
    if (boxes.some((box) => box.maxLength != null && box.maxLength < 1)) return null;
    return boxes.map((box, i) => fillAction(box, chars[i]));
  }
  return null;
}

/**
 * A plan that gives every one of a code's single-character boxes the whole code:
 * each box would keep only its first character. Hand box i the i-th character.
 * Other plans are left as they are.
 */
export function spreadCodeAcrossBoxes<T extends { action: string; value?: string | null }>(
  actions: T[] | null | undefined,
  code: string | undefined,
): T[] {
  if (!actions?.length) return actions ?? [];
  if (!code) return actions;
  const boxes = actions.filter((action) => action.action === "fill" && action.value === code);
  if (boxes.length < 2 || boxes.length !== code.length) return actions;
  const chars = Array.from(code);
  boxes.forEach((action, i) => {
    action.value = chars[i];
  });
  return actions;
}
