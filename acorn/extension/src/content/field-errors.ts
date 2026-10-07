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

import { choiceOptionLabel } from "./agents/choice-group";
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
import { inferRole } from "./verify/element-role";

import type { FieldIssue, FieldIssueScan } from "@acorn/shared/field-issues";

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

function currentValue(control: Element, members: Element[]): string {
  if (members.length > 1 || choiceGroupKey(control)) {
    return members
      .filter((el) => (el as HTMLInputElement).checked)
      .map((el) => choiceOptionLabel(el))
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
