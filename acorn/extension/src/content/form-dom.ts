/**
 * Generic DOM reading for form fields, shared by Refill's error scan and the fast
 * planner's field list: visibility, open shadow roots and same-origin frames,
 * radio/checkbox groups, each control's own field wrapper, and its question label.
 * Structural only — no host class names or copy.
 */

import { getDirectText } from "./dom-serializer";
import { FILLABLE_SELECTOR } from "./form-frame";
import { labelCandidates, uniqueById } from "./verify/element-labels";
import { inferRole } from "./verify/element-role";

export const ACORN_ID_ATTR = "data-acorn-id";
/** How far up from a control to look for its own field wrapper. */
const MAX_WRAPPER_DEPTH = 6;
/** Labels and messages longer than this are clipped. */
export const MAX_TEXT_CHARS = 200;
/** Option lists and choice labels belong to the control, not to its error text. */
const CONTROL_PART_SELECTOR =
  'label, option, select, [role="option"], [role="listbox"], [role="radio"], [role="checkbox"], [role="menu"], [role="menuitem"]';
const CHOICE_TYPES = new Set(["radio", "checkbox"]);

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function isVisible(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  return !style || (style.display !== "none" && style.visibility !== "hidden");
}

/** Smallest box, in px, a person can see and type into. */
const MIN_FIELD_PX = 2;

/**
 * Whether the field itself is fully transparent. Only its own opacity counts: a
 * dialog fading in animates its container, and its fields are still real.
 */
function isTransparent(el: Element): boolean {
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  return Boolean(style && Number(style.opacity) === 0);
}

/**
 * A text field a person can see and type into: visible, not fully transparent,
 * bigger than a pixel or two, and not placed outside the page. A field built for
 * robots to fill (and people to leave empty) fails one of these.
 */
export function isPersonFacing(el: Element): boolean {
  if (!isVisible(el) || isTransparent(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < MIN_FIELD_PX || rect.height < MIN_FIELD_PX) return false;
  const view = el.ownerDocument?.defaultView;
  return rect.right + (view?.scrollX ?? 0) > 0 && rect.bottom + (view?.scrollY ?? 0) > 0;
}

export function matchesSafe(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false; // Selector unsupported by this browser.
  }
}

/** Document, open shadow roots, and same-origin iframes — the same reach as the serializer. */
export function queryDeep(root: ParentNode, selector: string, out: Element[] = []): Element[] {
  out.push(...Array.from(root.querySelectorAll(selector)));
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (el.shadowRoot) queryDeep(el.shadowRoot, selector, out);
    if (el instanceof HTMLIFrameElement) {
      try {
        if (el.contentDocument) queryDeep(el.contentDocument, selector, out);
      } catch {
        /* cross-origin frame */
      }
    }
  }
  return out;
}

/** Containers whose accessible name is the question their controls answer. */
export const NAMED_GROUP_SELECTOR = 'fieldset, [role="group"], [role="radiogroup"]';

/**
 * A named group (fieldset, role=group) holding several checkboxes and no other
 * control: one question whose boxes may each carry their own name ("Black",
 * "Caribbean"), so the name alone does not group them.
 */
function checkboxSetGroup(el: Element): Element | null {
  if (!(el instanceof HTMLInputElement) || el.type !== "checkbox") return null;
  const group = el.closest(NAMED_GROUP_SELECTOR);
  if (!group) return null;
  const controls = Array.from(group.querySelectorAll(FILLABLE_SELECTOR));
  const onlyBoxes = controls.every(
    (control) => control instanceof HTMLInputElement && control.type === "checkbox",
  );
  return onlyBoxes && controls.length > 1 ? group : null;
}

/** Stable per-page keys for checkbox-set groups, which have no shared name to key by. */
const groupKeys = new WeakMap<Element, string>();
let nextGroupKey = 0;

function checkboxSetKey(group: Element): string {
  let key = groupKeys.get(group);
  if (!key) {
    nextGroupKey += 1;
    key = `checkbox-set:${nextGroupKey}`;
    groupKeys.set(group, key);
  }
  return key;
}

export function choiceGroupKey(el: Element): string | null {
  if (!(el instanceof HTMLInputElement) || !CHOICE_TYPES.has(el.type)) return null;
  const set = checkboxSetGroup(el);
  if (set) return checkboxSetKey(set);
  return el.name ? `${el.type}:${el.form?.id ?? ""}:${el.name}` : null;
}

/** Distinct questions inside `root`: a radio/checkbox group or a combobox+listbox pair counts once. */
export function distinctFieldCount(root: Element): number {
  const controls = Array.from(root.querySelectorAll(FILLABLE_SELECTOR));
  const outer = controls.filter(
    (el) => !controls.some((other) => other !== el && other.contains(el)),
  );
  const hasCombobox = outer.some((el) => inferRole(el) === "combobox");
  const keys = new Set<unknown>();
  for (const el of outer) {
    if (hasCombobox && el.getAttribute("role") === "listbox") continue;
    keys.add(choiceGroupKey(el) ?? el);
  }
  return keys.size;
}

/** The highest ancestor that still holds only this one question. */
export function fieldWrapper(control: Element): Element {
  let wrapper: Element = control;
  let node = control.parentElement;
  for (let depth = 0; node && depth < MAX_WRAPPER_DEPTH; depth += 1) {
    if (node === node.ownerDocument.body || distinctFieldCount(node) > 1) break;
    wrapper = node;
    node = node.parentElement;
  }
  return wrapper;
}

/** Visible wrapper text before or after the control, outside any control part. */
export function wrapperTexts(
  control: Element,
  wrapper: Element,
  position: number,
  skip: Set<string>,
): string[] {
  if (wrapper === control) return [];
  const texts: string[] = [];
  for (const el of Array.from(wrapper.querySelectorAll("*"))) {
    if (el === control || control.contains(el) || el.contains(control)) continue;
    if (!(control.compareDocumentPosition(el) & position)) continue;
    if (matchesSafe(el, FILLABLE_SELECTOR) || el.closest(CONTROL_PART_SELECTOR)) continue;
    const text = getDirectText(el);
    if (!text || skip.has(normalize(text)) || !isVisible(el)) continue;
    skip.add(normalize(text));
    texts.push(clip(text, MAX_TEXT_CHARS));
  }
  return texts;
}

/**
 * A radio/checkbox group's question: its own label names one option ("Yes"),
 * so read the nearest text before the group inside the group's wrapper.
 */
export function fieldLabel(control: Element, members: Element[], wrapper: Element): string {
  if (members.length > 1) {
    const question =
      groupAccessibleName(control) ||
      groupQuestion(wrapper, control, members) ||
      wrapperTexts(control, wrapper, Node.DOCUMENT_POSITION_PRECEDING, new Set()).at(-1);
    if (question) return question;
  }
  return clip(labelCandidates(control)[0] ?? "", MAX_TEXT_CHARS);
}

/**
 * The accessible name of the group a control sits in (ARIA): aria-labelledby,
 * aria-label, or a fieldset's legend. "" when the control is in no named group.
 */
export function groupAccessibleName(control: Element): string {
  const group = control.closest(NAMED_GROUP_SELECTOR);
  if (!group) return "";
  const ids = (group.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  const byIds = ids.map((id) => uniqueById(group, id)?.textContent || "").join(" ");
  const legend =
    group instanceof HTMLFieldSetElement ? group.querySelector(":scope > legend")?.textContent : "";
  return clip(byIds || group.getAttribute("aria-label") || legend || "", MAX_TEXT_CHARS);
}

/** How far up from a control to look for its section's heading. */
const MAX_SECTION_DEPTH = 12;
const SECTION_TITLE_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"], legend';

/**
 * The heading of the form section a control sits in: the nearest heading or
 * legend before it, found in its closest ancestor that has one. It tells the same
 * label apart in different sections ("First Name" under References).
 */
export function sectionTitle(control: Element): string {
  let node = control.parentElement;
  for (let depth = 0; node && depth < MAX_SECTION_DEPTH; depth += 1) {
    const headings = Array.from(node.querySelectorAll(SECTION_TITLE_SELECTOR)).filter(
      (el) =>
        !el.contains(control) &&
        Boolean(control.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) &&
        isVisible(el),
    );
    const nearest = headings.at(-1);
    if (nearest) return clip(nearest.textContent || "", MAX_TEXT_CHARS);
    node = node.parentElement;
  }
  return "";
}

/** Elements that title a field: a legend, a heading, or a label. */
const QUESTION_SELECTOR = 'legend, label, h1, h2, h3, h4, h5, h6, [role="heading"]';

/**
 * The question a group of options answers: the nearest legend, heading, or label
 * before the first option inside the field's wrapper — skipping labels that name
 * one of the options themselves.
 */
export function groupQuestion(wrapper: Element, first: Element, members: Element[]): string {
  const memberSet = new Set(members);
  const titles = Array.from(wrapper.querySelectorAll(QUESTION_SELECTOR)).filter((el) => {
    if (!(first.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)) return false;
    if (el.contains(first)) return false;
    const control = el instanceof HTMLLabelElement ? el.control : null;
    return !(control && memberSet.has(control)) && isVisible(el);
  });
  const nearest = titles.at(-1);
  return nearest ? clip(nearest.textContent || "", MAX_TEXT_CHARS) : "";
}

export function groupMembers(control: Element): Element[] {
  const set = checkboxSetGroup(control);
  if (set) return Array.from(set.querySelectorAll('input[type="checkbox"]'));
  const key = choiceGroupKey(control);
  if (!key) return [control];
  const input = control as HTMLInputElement;
  const scope = input.form ?? (control.getRootNode() as Document | ShadowRoot);
  return Array.from(
    scope.querySelectorAll(`input[type="${input.type}"][name="${CSS.escape(input.name)}"]`),
  );
}

export function isRequired(members: Element[]): boolean {
  return members.some(
    (el) =>
      (el as HTMLInputElement).required === true || el.getAttribute("aria-required") === "true",
  );
}
