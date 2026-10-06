/**
 * Read which form fields the page flags after Submit / Next, for Refill.
 *
 * Vendor-agnostic: every signal comes from standard ARIA (aria-invalid,
 * aria-errormessage, aria-describedby, role="alert"), native constraint
 * validation (:user-invalid, validationMessage), or the control's own field
 * wrapper. No host class names, ids, or message copy are matched here — the
 * planner reads the collected text and decides what is actually an error.
 */

import type { FieldIssue, FieldIssueScan } from "@acorn/shared/field-issues";
import { choiceOptionLabel } from "./agents/choice-group";
import { readControlValue } from "./agents/read-control-value";
import { getDirectText } from "./dom-serializer";
import { FILLABLE_SELECTOR } from "./form-frame";
import { labelCandidates } from "./verify/element-labels";
import { inferRole } from "./verify/element-role";

const ACORN_ID_ATTR = "data-acorn-id";
/** How far up from a control to look for its own field wrapper. */
const MAX_WRAPPER_DEPTH = 6;
const MAX_MESSAGES_PER_FIELD = 4;
const MAX_MESSAGE_CHARS = 200;
const MAX_VALUE_CHARS = 120;
const MAX_FIELD_ISSUES = 40;
const MAX_PAGE_MESSAGES = 5;

/** Page-level announcements: standard ARIA only. */
const PAGE_MESSAGE_SELECTOR = '[role="alert"], [aria-live="assertive"]';
/** Option lists and choice labels belong to the control, not to its error text. */
const CONTROL_PART_SELECTOR =
  'label, option, select, [role="option"], [role="listbox"], [role="radio"], [role="checkbox"], [role="menu"], [role="menuitem"]';
const CHOICE_TYPES = new Set(["radio", "checkbox"]);

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function isVisible(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  return !style || (style.display !== "none" && style.visibility !== "hidden");
}

function matchesSafe(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false; // Selector unsupported by this browser.
  }
}

/** Document, open shadow roots, and same-origin iframes — the same reach as the serializer. */
function queryDeep(root: ParentNode, selector: string, out: Element[] = []): Element[] {
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

function choiceGroupKey(el: Element): string | null {
  if (!(el instanceof HTMLInputElement) || !CHOICE_TYPES.has(el.type)) return null;
  return el.name ? `${el.type}:${el.form?.id ?? ""}:${el.name}` : null;
}

/** Distinct questions inside `root`: a radio/checkbox group or a combobox+listbox pair counts once. */
function distinctFieldCount(root: Element): number {
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
function fieldWrapper(control: Element): Element {
  let wrapper: Element = control;
  let node = control.parentElement;
  for (let depth = 0; node && depth < MAX_WRAPPER_DEPTH; depth += 1) {
    if (node === node.ownerDocument.body || distinctFieldCount(node) > 1) break;
    wrapper = node;
    node = node.parentElement;
  }
  return wrapper;
}

function textOfIds(control: Element, attr: string): string[] {
  const ids = (control.getAttribute(attr) || "").split(/\s+/).filter(Boolean);
  const root = control.getRootNode() as Document | ShadowRoot;
  const messages: string[] = [];
  for (const id of ids) {
    const ref = root.getElementById?.(id) ?? control.ownerDocument.getElementById(id);
    if (!ref || !isVisible(ref)) continue;
    const text = clip(ref.textContent || "", MAX_MESSAGE_CHARS);
    if (text) messages.push(text);
  }
  return messages;
}

function isUserInvalid(control: Element): boolean {
  return matchesSafe(control, ":user-invalid");
}

function linkedMessages(control: Element): string[] {
  const messages = [
    ...textOfIds(control, "aria-errormessage"),
    ...textOfIds(control, "aria-describedby"),
  ];
  const native = (control as HTMLInputElement).validationMessage;
  if (native && isUserInvalid(control)) messages.push(clip(native, MAX_MESSAGE_CHARS));
  return messages;
}

/** Visible wrapper text before or after the control, outside any control part. */
function wrapperTexts(
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
    texts.push(clip(text, MAX_MESSAGE_CHARS));
  }
  return texts;
}

/** Text after the control inside its own field wrapper — where field errors render. */
function nearbyMessages(control: Element, wrapper: Element, skip: Set<string>): string[] {
  return wrapperTexts(control, wrapper, Node.DOCUMENT_POSITION_FOLLOWING, skip).slice(
    0,
    MAX_MESSAGES_PER_FIELD,
  );
}

/**
 * A radio/checkbox group's question: its own label names one option ("Yes"),
 * so read the nearest text before the group inside the group's wrapper.
 */
function fieldLabel(control: Element, members: Element[], wrapper: Element): string {
  if (members.length > 1) {
    const before = wrapperTexts(control, wrapper, Node.DOCUMENT_POSITION_PRECEDING, new Set());
    const question = before.at(-1);
    if (question) return question;
  }
  return clip(labelCandidates(control)[0] ?? "", MAX_MESSAGE_CHARS);
}

function groupMembers(control: Element): Element[] {
  const key = choiceGroupKey(control);
  if (!key) return [control];
  const input = control as HTMLInputElement;
  const scope = input.form ?? (control.getRootNode() as Document | ShadowRoot);
  return Array.from(
    scope.querySelectorAll(`input[type="${input.type}"][name="${CSS.escape(input.name)}"]`),
  );
}

function currentValue(control: Element, members: Element[]): string {
  if (members.length > 1 || choiceGroupKey(control)) {
    return members
      .filter((el) => (el as HTMLInputElement).checked)
      .map((el) => choiceOptionLabel(el))
      .join(", ");
  }
  return readControlValue(control);
}

function isRequired(members: Element[]): boolean {
  return members.some(
    (el) =>
      (el as HTMLInputElement).required === true || el.getAttribute("aria-required") === "true",
  );
}

function describeControl(control: Element): FieldIssue | null {
  const elementIndex = Number(control.getAttribute(ACORN_ID_ATTR));
  if (!Number.isFinite(elementIndex) || elementIndex <= 0) return null;

  const members = groupMembers(control);
  const value = clip(currentValue(control, members), MAX_VALUE_CHARS);
  const required = isRequired(members);
  const invalid = members.some(
    (el) => el.getAttribute("aria-invalid") === "true" || isUserInvalid(el),
  );
  const linked = members.flatMap(linkedMessages);
  const wrapper = fieldWrapper(control);
  const label = fieldLabel(control, members, wrapper);
  const skip = new Set([normalize(label), normalize(value), ...linked.map(normalize)]);
  const nearby = nearbyMessages(control, wrapper, skip);
  const emptyRequired = required && !value;

  if (!invalid && !linked.length && !nearby.length && !emptyRequired) return null;
  return {
    elementIndex,
    label,
    role: inferRole(control),
    value,
    required,
    invalid,
    linkedMessages: [...new Set(linked)],
    nearbyMessages: nearby,
  };
}

/** Hard signals first, so the cap never drops a field the page marked invalid. */
function issueRank(issue: FieldIssue): number {
  if (issue.invalid) return 0;
  if (issue.linkedMessages.length) return 1;
  if (issue.required && !issue.value) return 2;
  return 3;
}

function pageMessages(): string[] {
  const messages = new Set<string>();
  for (const el of queryDeep(document, PAGE_MESSAGE_SELECTOR)) {
    if (!isVisible(el)) continue;
    const text = clip((el as HTMLElement).innerText || el.textContent || "", MAX_MESSAGE_CHARS);
    if (text) messages.add(text);
    if (messages.size >= MAX_PAGE_MESSAGES) break;
  }
  return [...messages];
}

/**
 * Scan controls stamped by the last `serializeDom()` pass. Call it right after
 * serializing so each issue's elementIndex matches the Pure Tree.
 */
export function scanFieldIssues(): FieldIssueScan {
  const seenGroups = new Set<string>();
  const issues: FieldIssue[] = [];
  for (const control of queryDeep(document, `:is(${FILLABLE_SELECTOR})[${ACORN_ID_ATTR}]`)) {
    const group = choiceGroupKey(control);
    if (group) {
      if (seenGroups.has(group)) continue;
      seenGroups.add(group);
    }
    const issue = describeControl(control);
    if (issue) issues.push(issue);
  }
  issues.sort((a, b) => issueRank(a) - issueRank(b));
  return { issues: issues.slice(0, MAX_FIELD_ISSUES), pageMessages: pageMessages() };
}
