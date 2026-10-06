/**
 * Choice groups the SelectorGateway (TypeSafe Jev) decides: radio / Yes-No /
 * button groups take Jev's single most probable option; checkbox groups take
 * every box Jev says to check. Options are read structurally (native inputs,
 * ARIA roles, visible buttons) — no vendor classes.
 */

import {
  choiceOptionLabel,
  findVisibleChoiceOption,
  hasClickableBox,
  inputOptionLabel,
} from "./choice-group";
import { isChoiceSelected } from "./choice-state";
import { askAiMatchOption } from "./match-option-client";
import { pointerActivate } from "./pointer-activate";

/** Button labels longer than this are prose, not an option a person picks. */
const MAX_BUTTON_LABEL_CHARS = 60;

type ChoiceControl = { el: HTMLElement; label: string };

function uniqueByLabel(controls: ChoiceControl[]): ChoiceControl[] {
  const seen = new Set<string>();
  return controls.filter((control) => {
    const key = control.label.toLowerCase();
    if (!control.label || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function checkboxes(root: ParentNode): ChoiceControl[] {
  const native = Array.from(root.querySelectorAll('input[type="checkbox"]')).map((el) => ({
    el: el as HTMLElement,
    label: inputOptionLabel(el),
  }));
  const aria = Array.from(root.querySelectorAll('[role="checkbox"]'))
    .filter((el) => hasClickableBox(el))
    .map((el) => ({ el: el as HTMLElement, label: choiceOptionLabel(el) }));
  return uniqueByLabel([...native, ...aria]);
}

/** The single-answer options in a field: radios, ARIA radios, else visible choice buttons. */
function singleChoices(root: ParentNode): ChoiceControl[] {
  const radios = [
    ...Array.from(root.querySelectorAll('input[type="radio"]')).map((el) => ({
      el: el as HTMLElement,
      label: inputOptionLabel(el),
    })),
    ...Array.from(root.querySelectorAll('[role="radio"], [role="switch"]'))
      .filter((el) => hasClickableBox(el))
      .map((el) => ({ el: el as HTMLElement, label: choiceOptionLabel(el) })),
  ];
  if (radios.length) return uniqueByLabel(radios);
  return uniqueByLabel(
    Array.from(root.querySelectorAll('button, [role="button"], [aria-pressed]'))
      .filter((el) => hasClickableBox(el))
      .map((el) => ({ el: el as HTMLElement, label: choiceOptionLabel(el) }))
      .filter((control) => control.label.length <= MAX_BUTTON_LABEL_CHARS),
  );
}

/** True when the field holds a group of checkboxes (an answer that is a set). */
export function isCheckboxGroup(root: ParentNode): boolean {
  return checkboxes(root).length > 1;
}

/**
 * Jev's most probable single option label for this field, or null when the field
 * has no options or the gateway could not decide.
 */
export async function pickSingleChoice(
  root: ParentNode,
  intended: string,
  fieldLabel: string | null,
): Promise<string | null> {
  const options = singleChoices(root).map((control) => control.label);
  if (!options.length) return null;
  const ai = await askAiMatchOption({
    intendedValue: intended,
    options,
    fieldLabel,
    typedQuery: null,
  });
  return ai.matched_option ?? ai.fallback_option ?? null;
}

function setChecked(control: ChoiceControl, want: boolean): void {
  if (isChoiceSelected(control.el) === want) return;
  // A hidden native box is a proxy: click the visible option that carries its label.
  const target = hasClickableBox(control.el)
    ? control.el
    : (findVisibleChoiceOption(control.el, control.label) ?? control.el);
  pointerActivate(target);
}

/**
 * Set a checkbox group to exactly the boxes Jev chooses. Returns the checked
 * labels, or null when the gateway could not decide (the caller falls back).
 */
export async function applyCheckboxSet(
  root: ParentNode,
  intended: string,
  fieldLabel: string | null,
): Promise<string | null> {
  const controls = checkboxes(root);
  if (controls.length < 2) return null;
  const ai = await askAiMatchOption({
    intendedValue: intended,
    options: controls.map((control) => control.label),
    fieldLabel,
    typedQuery: null,
    multiple: true,
  });
  const chosen = new Set((ai.matched_options ?? []).map((label) => label.toLowerCase()));
  if (!ai.ok || !chosen.size) return null;
  for (const control of controls) {
    setChecked(control, chosen.has(control.label.toLowerCase()));
  }
  return controls
    .filter((control) => chosen.has(control.label.toLowerCase()))
    .map((control) => control.label)
    .join(", ");
}
