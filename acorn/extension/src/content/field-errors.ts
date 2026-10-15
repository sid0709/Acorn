/**
 * Read which form fields the page flags after Submit / Next, for Refill.
 *
 * Vendor-agnostic: every signal comes from standard ARIA (aria-invalid,
 * aria-errormessage, aria-describedby, role="alert"), native constraint
 * validation (:user-invalid, validationMessage), or the control's own field
 * wrapper. No host class names, ids, or message copy are matched here — the
 * planner reads the collected text and decides what is actually an error.
 */

import { shownValue } from "@acorn/shared/secret-value";

import { choiceOptionLabel, inputOptionLabel } from "./agents/choice-group";
import { isListOpener } from "./agents/combobox/list-opener";
import { LIST_OPENER_ATTR } from "./agents/combobox/popup-roles";
import { wasGroupAnswered } from "./agents/plan-fill-registry";
import { readControlValue } from "./agents/read-control-value";
import {
  ACORN_ID_ATTR,
  choiceGroupKey,
  clip,
  fieldLabel,
  fieldWrapper,
  groupMembers,
  isRequired,
  isVisible,
  matchesSafe,
  normalize,
  queryDeep,
  wrapperTexts,
} from "./form-dom";
import { FILLABLE_SELECTOR } from "./form-frame";
import { isA } from "./realm";
import { inferRole } from "./verify/element-role";

import type { FieldIssue, FieldIssueScan } from "@acorn/shared/field-issues";

/** The value of a checked box with no words of its own. */
const CHECKED_ANSWER = "checked";
const MAX_MESSAGES_PER_FIELD = 4;
const MAX_MESSAGE_CHARS = 200;
const MAX_VALUE_CHARS = 120;
const MAX_FIELD_ISSUES = 40;
const MAX_PAGE_MESSAGES = 5;

/** Page-level announcements: standard ARIA only. */
const PAGE_MESSAGE_SELECTOR = '[role="alert"], [aria-live="assertive"]';

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

/** The page marks the control itself invalid: aria-invalid, or native constraint validation. */
export function isMarkedInvalid(control: Element): boolean {
  return control.getAttribute("aria-invalid") === "true" || isUserInvalid(control);
}

/**
 * What the page marked invalid the first time it showed the control, before any
 * answer: a page that marks an optional empty field invalid (which nothing can be
 * wrong with) uses the mark as decoration on every field, not as a verdict.
 */
const markedAtFirstSight = new WeakSet<Element>();
const seenControls = new WeakSet<Element>();
let marksAreDecoration = false;

/** Remember how the page marks the controls it shows now. Call it on every read of the page. */
export function noteInvalidBaseline(): void {
  for (const control of queryDeep(document, `:is(${FILLABLE_SELECTOR})[${ACORN_ID_ATTR}]`)) {
    if (seenControls.has(control)) continue;
    seenControls.add(control);
    if (!isMarkedInvalid(control)) continue;
    markedAtFirstSight.add(control);
    if (!isRequired([control]) && !readControlValue(control)) marksAreDecoration = true;
  }
}

/** A mark the page put on the control from the start, with nothing said about it: no verdict. */
function isDecorationMark(control: Element, hasMessage: boolean): boolean {
  return marksAreDecoration && markedAtFirstSight.has(control) && !hasMessage;
}

/** Whether the page shows words for the control: an error tied to it or text beside it. */
function hasMessage(control: Element): boolean {
  return (
    linkedMessages(control).length > 0 ||
    nearbyMessages(control, fieldWrapper(control), new Set()).length > 0
  );
}

/**
 * The page asks for this control's answer: it requires it, marks it invalid, or (a
 * dropdown drawn as a button, which carries no required attribute) shows words beside it.
 */
export function pageWantsAnswer(control: Element): boolean {
  if (isRequired([control])) return true;
  if (isMarkedInvalid(control)) return !isDecorationMark(control, hasMessage(control));
  return isListOpener(control) && hasMessage(control);
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

/** Text after the control inside its own field wrapper — where field errors render. */
function nearbyMessages(control: Element, wrapper: Element, skip: Set<string>): string[] {
  return wrapperTexts(control, wrapper, Node.DOCUMENT_POSITION_FOLLOWING, skip).slice(
    0,
    MAX_MESSAGES_PER_FIELD,
  );
}

/**
 * What a checked box or radio answers: its option's words. A native input has no text of
 * its own (its label is beside it), so it is read through its label; a box that names
 * nothing still answers "checked", never empty.
 */
function checkedAnswer(el: Element): string {
  const words = isA(el, HTMLInputElement) ? inputOptionLabel(el) : choiceOptionLabel(el);
  return words || CHECKED_ANSWER;
}

function currentValue(control: Element, members: Element[]): string {
  if (members.length > 1 || choiceGroupKey(control)) {
    return members
      .filter((el) => (el as HTMLInputElement).checked)
      .map((el) => checkedAnswer(el))
      .join(", ");
  }
  return readControlValue(control);
}

function describeControl(control: Element): FieldIssue | null {
  const elementIndex = Number(control.getAttribute(ACORN_ID_ATTR));
  if (!Number.isFinite(elementIndex) || elementIndex <= 0) return null;

  const members = groupMembers(control);
  const value = clip(shownValue(control, currentValue(control, members)), MAX_VALUE_CHARS);
  const required = isRequired(members);
  const linked = members.flatMap(linkedMessages);
  const wrapper = fieldWrapper(control);
  const label = fieldLabel(control, members, wrapper);
  const skip = new Set([normalize(label), normalize(value), ...linked.map(normalize)]);
  const nearby = nearbyMessages(control, wrapper, skip);
  const invalid = members.some(
    (member) =>
      isMarkedInvalid(member) && !isDecorationMark(member, linked.length > 0 || nearby.length > 0),
  );
  // A choice the plan answered in this document reads empty when the page drew the
  // group again and reset its hidden inputs while keeping the answer itself. Only
  // the page marking it (invalid, or an error tied to it) says it is really unanswered.
  const redrawnAnswer =
    members.length > 1 &&
    !value &&
    wasGroupAnswered(choiceGroupKey(control)) &&
    !invalid &&
    !linked.length;
  const emptyRequired = required && !value && !redrawnAnswer;

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
  // A router's live region announces the document title on each route; that is no alert.
  const title = normalize(document.title);
  for (const el of queryDeep(document, PAGE_MESSAGE_SELECTOR)) {
    if (!isVisible(el)) continue;
    const text = clip((el as HTMLElement).innerText || el.textContent || "", MAX_MESSAGE_CHARS);
    if (text && normalize(text) !== title) messages.add(text);
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
  const controls = queryDeep(
    document,
    `:is(${FILLABLE_SELECTOR}, [${LIST_OPENER_ATTR}])[${ACORN_ID_ATTR}]`,
  );
  for (const control of controls) {
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
