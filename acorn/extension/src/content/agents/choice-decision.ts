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
import { choiceState } from "./choice-state";
import { askAiMatchOption } from "./match-option-client";
import { pointerActivate } from "./pointer-activate";

/** Button labels longer than this are prose, not an option a person picks. */
const MAX_BUTTON_LABEL_CHARS = 60;
/**
 * The planner often emits one step per box of the same checkbox group. The first
 * step decides the whole set; steps on that group within this window reuse it.
 */
const CHECKBOX_DECISION_REUSE_MS = 30_000;

const checkboxDecisions = new Map<ParentNode, { at: number; labels: string }>();

function recentDecision(root: ParentNode): string | null {
  for (const [group, decision] of checkboxDecisions) {
    const stale = Date.now() - decision.at > CHECKBOX_DECISION_REUSE_MS;
    if (stale || !(group as Node).isConnected) checkboxDecisions.delete(group);
  }
  return checkboxDecisions.get(root)?.labels ?? null;
}

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
/** Every checkbox label in the field (an answer that is a set). */
export function checkboxLabels(root: ParentNode): string[] {
  return checkboxes(root).map((control) => control.label);
}

/** Every single-answer option label in the field (radios, else choice buttons). */
export function singleChoiceLabels(root: ParentNode): string[] {
  return singleChoices(root).map((control) => control.label);
}

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
  // Unknown state never earns a click to clear it: a click might choose it instead.
  const state = choiceState(control.el);
  if (state === want || (state == null && !want)) return;
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
  const decided = recentDecision(root);
  if (decided != null) return decided;
  // A value that names boxes exactly (a batch decision) is applied without asking again.
  const named = intended.split(/\s*,\s*/).map((part) => part.toLowerCase());
  const byLabel = new Set(controls.map((control) => control.label.toLowerCase()));
  if (named.length && named.every((part) => byLabel.has(part))) {
    return applyChosen(root, controls, new Set(named));
  }
  const ai = await askAiMatchOption({
    intendedValue: intended,
    options: controls.map((control) => control.label),
    fieldLabel,
    typedQuery: null,
    multiple: true,
  });
  const chosen = new Set((ai.matched_options ?? []).map((label) => label.toLowerCase()));
  if (!ai.ok || !chosen.size) return null;
  return applyChosen(root, controls, chosen);
}

/** Set the group to exactly `chosen` (lower-case labels) and remember the decision. */
function applyChosen(root: ParentNode, controls: ChoiceControl[], chosen: Set<string>): string {
  for (const control of controls) {
    setChecked(control, chosen.has(control.label.toLowerCase()));
  }
  const labels = controls
    .filter((control) => chosen.has(control.label.toLowerCase()))
    .map((control) => control.label)
    .join(", ");
  checkboxDecisions.set(root, { at: Date.now(), labels });
  return labels;
}
