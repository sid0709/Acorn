import { fieldWrapper } from "../form-dom";
import { inferElementRole } from "../verify-element";

import { applyCheckboxSet, isCheckboxGroup, pickSingleChoice } from "./choice-decision";
import {
  choiceOptionLabel,
  containsWords,
  findVisibleChoiceOption,
  inputOptionLabel,
  isProxyControl,
} from "./choice-group";
import { choiceState } from "./choice-state";
import { findAssociatedCombobox, findComboboxForOption } from "./enhanced-select";
import { fillNativeSelect } from "./native-select";
import { pointerActivate } from "./pointer-activate";
import { selectComboboxOption } from "./select-combobox";
import { waitMs } from "./wait";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The option's label (or native value) is exactly the value. */
function labelsEqual(option: Element, value: string): boolean {
  const n = normalize(value);
  if (!n) return false;
  const rawValue = option instanceof HTMLInputElement ? normalize(option.value) : "";
  return normalize(inputOptionLabel(option)) === n || rawValue === n;
}

/** Exactly equal, or one holds the other as whole words ("No" is not in "I do not know"). */
/** The node whose label is exactly the value, else the first that matches it as words. */
function pickByLabel<T extends Element>(nodes: T[], value: string): T | null {
  return (
    nodes.find((node) => labelsEqual(node, value)) ??
    nodes.find((node) => labelsMatch(node, value)) ??
    null
  );
}

function labelsMatch(option: Element, value: string): boolean {
  if (!normalize(value)) return false;
  const label = inputOptionLabel(option);
  return labelsEqual(option, value) || containsWords(label, value) || containsWords(value, label);
}

function isBooleanIntent(value: string): boolean {
  return /^(true|yes|1|on|checked|false|no|0|off|unchecked)$/i.test(value.trim());
}

function wantChecked(value: string): boolean {
  return /^(true|yes|1|on|checked)$/i.test(value.trim());
}

function isDisplayed(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) return false;
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  if (!style) return Boolean(el.offsetParent);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function findDisplayedOption(listbox: Element | null, value: string): HTMLElement | null {
  if (!listbox) return null;
  const nodes = Array.from(listbox.querySelectorAll('[role="option"]')).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && isDisplayed(node),
  );
  return pickByLabel(nodes, value);
}

const GROUP_CONTAINER_SELECTOR =
  'fieldset, [role="group"], [role="radiogroup"], [class*="Field"], [class*="field"], td, th, form';
/** Option buttons: a field whose answers are buttons rather than native inputs. */
const OPTION_BUTTON_SELECTOR = 'button, [role="button"], [role="radio"], [aria-pressed]';
/** How long an ARIA toggle gets to show its new state after a click. */
const ARIA_STATE_SETTLE_MS = 150;
/** How far up from an option button to look for the set of options it belongs to. */
const OPTION_SET_MAX_DEPTH = 4;

/**
 * The nearest ancestor holding this option button and another like it: one
 * question's options (a <ul role="list"> of Yes / No buttons), found by structure
 * when no grouping container names them.
 */
function optionSetRoot(el: HTMLElement): HTMLElement | null {
  if (el instanceof HTMLInputElement || !el.matches(OPTION_BUTTON_SELECTOR)) return null;
  let node = el.parentElement;
  for (let depth = 0; node && depth < OPTION_SET_MAX_DEPTH; depth += 1) {
    if (node.querySelectorAll(OPTION_BUTTON_SELECTOR).length > 1) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * A native radio's group as the browser defines it: every input of its type that
 * shares its name in the same form. Null when it shares its name with no other.
 */
function sameNameGroup(el: HTMLElement): HTMLInputElement[] | null {
  if (!(el instanceof HTMLInputElement) || !el.name) return null;
  if (el.type !== "radio" && el.type !== "checkbox") return null;
  const scope: ParentNode = el.form ?? (el.getRootNode() as Document | ShadowRoot);
  const members = Array.from(
    scope.querySelectorAll(`input[type="${el.type}"][name="${CSS.escape(el.name)}"]`),
  ).filter((node): node is HTMLInputElement => node instanceof HTMLInputElement);
  return members.length > 1 ? members : null;
}

/** The deepest element holding every one of `nodes`. */
function commonAncestor(nodes: Element[]): ParentNode | null {
  let root: Element | null = nodes[0]?.parentElement ?? null;
  while (root && !nodes.every((node) => root?.contains(node))) root = root.parentElement;
  return root;
}

/**
 * The field a choice control belongs to. Named native options are grouped by
 * their name, rooted where they all meet, so another question's option with the
 * same label ("No") can never answer for this one. Otherwise the nearest grouping
 * container, or the nearest set of option buttons.
 */
export function groupRoot(el: HTMLElement): ParentNode {
  const named = sameNameGroup(el);
  const namedRoot = named ? commonAncestor(named) : null;
  if (namedRoot) return namedRoot;
  // A native box or radio with no named group answers one question: its own field
  // wrapper, never a wider container where another question's option shares its label.
  if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
    return fieldWrapper(el);
  }
  const container = el.closest(GROUP_CONTAINER_SELECTOR);
  const optionSet = optionSetRoot(el);
  // The nearer one wins: a page-wide <form> is not one question's group.
  const root = optionSet && (!container || container.contains(optionSet)) ? optionSet : container;
  return root || el.parentElement || el.ownerDocument || document;
}

function findChoiceInGroup(
  root: ParentNode,
  value: string,
  kind: "checkbox" | "radio",
): HTMLInputElement | null {
  const nodes = Array.from(root.querySelectorAll(`input[type="${kind}"]`)).filter(
    (node): node is HTMLInputElement => node instanceof HTMLInputElement,
  );
  // An exact label wins: "Hispanic or Latino" is inside "White (Not Hispanic or Latino)".
  return pickByLabel(nodes, value);
}

function findAriaChoice(root: ParentNode, value: string): HTMLElement | null {
  const nodes = Array.from(root.querySelectorAll('[role="checkbox"], [role="radio"]')).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
  return pickByLabel(nodes, value);
}

function findButtonChoice(root: ParentNode, value: string): HTMLElement | null {
  const nodes = Array.from(
    root.querySelectorAll('button, [role="button"], [role="radio"], [aria-pressed]'),
  ).filter((node): node is HTMLElement => node instanceof HTMLElement && isDisplayed(node));
  return pickByLabel(nodes, value);
}

function ensureChecked(el: HTMLInputElement, intended?: string): string {
  if (!el.checked) pointerActivate(el, intended);
  const label = inputOptionLabel(el) || el.value;
  // A click the page ignored (or undid) is a failed step, never a quiet success.
  if (!el.checked) throw new Error(`The page did not keep "${label || intended}" selected`);
  return label || "checked";
}

/**
 * Click an option only when it does not already read as chosen. A second click on
 * a chosen option un-chooses it on many widgets, so an even number of clicks
 * would cancel the answer.
 */
function activateUnlessChosen(el: HTMLElement): void {
  if (choiceState(el) === true) return;
  pointerActivate(el);
}

/** The field has options, but none carries the intended label. */
class NoChoiceMatch extends Error {}

/**
 * Select a choice field's answer. A checkbox group is decided as a set by the
 * SelectorGateway (Jev). Otherwise the option whose label is the value wins; when
 * no label matches, Jev picks the field's most probable option and that is selected.
 */
export async function selectRadioElement(
  el: Element,
  value: string | null,
  fieldHint: string | null = null,
): Promise<string> {
  const intended = value?.trim() || "";
  const root = groupRoot(el as HTMLElement);
  if (intended && !isBooleanIntent(intended) && !isDropdownTarget(el) && isCheckboxGroup(root)) {
    const checked = await applyCheckboxSet(root, intended, fieldHint);
    if (checked != null) return checked;
  }
  try {
    return await selectChoiceLocally(el, value);
  } catch (err) {
    if (!(err instanceof NoChoiceMatch)) throw err;
    const label = await pickSingleChoice(root, intended, fieldHint);
    if (!label || normalize(label) === normalize(intended)) throw err;
    return selectChoiceLocally(el, label);
  }
}

function isDropdownTarget(el: Element): boolean {
  const role = inferElementRole(el);
  return (
    el instanceof HTMLSelectElement ||
    el instanceof HTMLOptionElement ||
    role === "combobox" ||
    role === "option" ||
    (el as HTMLElement).getAttribute("aria-haspopup") === "listbox"
  );
}

/** A native radio or checkbox: the group option named by the answer, else the box itself. */
function selectNativeChoice(el: HTMLInputElement, intended: string): string {
  const kind = el.type === "radio" ? "radio" : "checkbox";
  if (intended && (kind === "radio" || !isBooleanIntent(intended))) {
    // The option named by the answer, even "Yes" / "No": checking the planned
    // radio would answer with whatever option happens to come first.
    const named =
      findChoiceInGroup(groupRoot(el), intended, kind) ?? (labelsMatch(el, intended) ? el : null);
    if (named) return ensureChecked(named, intended);
    // No option carries the answer: only a bare "check it" means this radio.
    if (kind === "checkbox" || !isBooleanIntent(intended) || !wantChecked(intended)) {
      throw new NoChoiceMatch(`No ${kind} option matching "${intended}"`);
    }
  }
  if (kind === "radio") return ensureChecked(el, intended);
  const check = !intended || wantChecked(intended);
  if (el.checked !== check) pointerActivate(el);
  if (el.checked !== check) {
    throw new Error(`The page did not keep the box ${check ? "checked" : "unchecked"}`);
  }
  return String(el.checked);
}

function isAriaChecked(el: Element): boolean {
  return el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-pressed") === "true";
}

/**
 * An ARIA radio or checkbox. The option the answer names wins, even "Yes" / "No";
 * only when no option carries it is the answer a plain check / uncheck of this one.
 * Null hands over to the generic search.
 */
async function selectAriaChoice(
  el: HTMLElement,
  role: "radio" | "checkbox",
  intended: string,
): Promise<string | null> {
  const named = findAriaChoice(groupRoot(el), intended) ?? (labelsMatch(el, intended) ? el : null);
  if (named) {
    if (!isAriaChecked(named)) pointerActivate(named);
    return inputOptionLabel(named) || intended;
  }
  if (!isBooleanIntent(intended)) return null;
  const want = wantChecked(intended);
  // A radio is never unchecked into a "no": that needs an option saying so.
  if (role === "radio" && !want) throw new NoChoiceMatch(`No radio option matching "${intended}"`);
  if (isAriaChecked(el) !== want) {
    pointerActivate(el);
    // A widget redraws its state after the click's handlers run, not during them.
    await waitMs(ARIA_STATE_SETTLE_MS);
  }
  if (isAriaChecked(el) !== want) {
    throw new Error(`The page did not keep the ${role} ${want ? "on" : "off"}`);
  }
  return String(want);
}

/** Local selection by boolean intent or visible option label (native and ARIA widgets). */
async function selectChoiceLocally(el: Element, value: string | null): Promise<string> {
  const html = el as HTMLElement;
  html.scrollIntoView({ block: "center", behavior: "auto" });

  const role = inferElementRole(el);
  if (el instanceof HTMLSelectElement && value) {
    const combo = findAssociatedCombobox(el);
    if (combo && combo !== el) return selectComboboxOption(combo, value);
    return fillNativeSelect(el, value);
  }
  if ((role === "combobox" || html.getAttribute("aria-haspopup") === "listbox") && value) {
    return selectComboboxOption(el, value);
  }

  const intended = value?.trim() || "";

  // Planner often targets role=option nodes for custom dropdowns — drive the parent combobox.
  const explicitAriaRole = (html.getAttribute("role") || "").toLowerCase();
  if (explicitAriaRole === "option" || el instanceof HTMLOptionElement) {
    const label = intended || inputOptionLabel(html);

    if (el instanceof HTMLOptionElement) {
      const select = el.closest("select");
      if (select instanceof HTMLSelectElement) {
        const combo = findAssociatedCombobox(select);
        if (combo && label) return selectComboboxOption(combo, label);
        select.value = el.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return inputOptionLabel(el) || label;
      }
    }

    const combo = findComboboxForOption(html);
    if (combo && label) return selectComboboxOption(combo, label);

    const visible = findDisplayedOption(html.closest('[role="listbox"]'), label);
    if (visible) {
      activateUnlessChosen(visible);
      return inputOptionLabel(visible) || label;
    }
    if (isDisplayed(html)) {
      activateUnlessChosen(html);
      return inputOptionLabel(html) || label;
    }
    throw new Error(`Dropdown option "${label}" is not open — no combobox trigger found`);
  }

  // A native input nobody can see is a proxy for the field's visible options.
  // Toggling it cannot express a negative answer (unchecked is the resting
  // state), so activate the visible option carrying the intended label instead.
  if (
    el instanceof HTMLInputElement &&
    (el.type === "radio" || el.type === "checkbox") &&
    intended &&
    isProxyControl(el)
  ) {
    const option = findVisibleChoiceOption(el, intended);
    if (option) {
      activateUnlessChosen(option);
      return choiceOptionLabel(option) || intended;
    }
  }

  if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
    return selectNativeChoice(el, intended);
  }

  // ARIA checkbox/radio without native input
  if ((explicitAriaRole === "checkbox" || explicitAriaRole === "radio") && intended) {
    const selected = await selectAriaChoice(html, explicitAriaRole, intended);
    if (selected != null) return selected;
  }

  // Custom choice buttons: the planned node is the option to activate.
  if (el instanceof HTMLButtonElement && intended && labelsMatch(html, intended)) {
    activateUnlessChosen(html);
    return inputOptionLabel(html) || intended;
  }

  if (intended) {
    const root = groupRoot(html);
    const checkbox = findChoiceInGroup(root, intended, "checkbox");
    if (checkbox) return ensureChecked(checkbox, intended);
    const radio = findChoiceInGroup(root, intended, "radio");
    if (radio) return ensureChecked(radio, intended);
    const aria = findAriaChoice(root, intended);
    if (aria) {
      activateUnlessChosen(aria);
      return inputOptionLabel(aria) || intended;
    }
    const button = findButtonChoice(root, intended);
    if (button) {
      activateUnlessChosen(button);
      return inputOptionLabel(button) || intended;
    }
  }

  const root = groupRoot(html);
  const radios = Array.from(root.querySelectorAll('input[type="radio"]'));
  if (radios.length && intended) {
    const target = findChoiceInGroup(root, intended, "radio");
    if (!target) throw new NoChoiceMatch(`No radio option matching "${intended}"`);
    return ensureChecked(target, intended);
  }

  // A field of option buttons with no label match: let the gateway pick among them.
  if (intended && root.querySelector('button, [role="button"], [role="radio"], [aria-pressed]')) {
    throw new NoChoiceMatch(`No option matching "${intended}"`);
  }

  if (intended) {
    return selectComboboxOption(el, intended);
  }

  activateUnlessChosen(html);
  return inputOptionLabel(el) || "clicked";
}
