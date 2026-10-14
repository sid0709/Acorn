/** Refill contract: what the page says is wrong with its fields after Submit / Next. */

import type { FieldIssueNote, FormField } from "./form-fields";

/** Fill plans every field; Refill only fixes the fields the page flagged. */
export const FILL_MODE = {
  fill: "fill",
  refill: "refill",
} as const;

export type FillMode = (typeof FILL_MODE)[keyof typeof FILL_MODE];

/**
 * One form control that shows a validation signal. Every signal is read from
 * standard ARIA, native constraint validation, or the control's own field
 * wrapper — never from host-specific class names or copy.
 */
export interface FieldIssue {
  /** Pure Tree node id of the control (same id the plan's element_index uses). */
  elementIndex: number;
  label: string;
  role: string;
  /** What the control shows right now. */
  value: string;
  required: boolean;
  /** aria-invalid="true" or :user-invalid on the control itself. */
  invalid: boolean;
  /** Messages the page ties to the control (aria-errormessage, aria-describedby, validationMessage). */
  linkedMessages: string[];
  /** Visible text inside the control's own field wrapper that follows the control. */
  nearbyMessages: string[];
}

export interface FieldIssueScan {
  issues: FieldIssue[];
  /** Visible role="alert" / live-region text not tied to a single field. */
  pageMessages: string[];
}

export const EMPTY_FIELD_ISSUE_SCAN: FieldIssueScan = { issues: [], pageMessages: [] };

/** Issues backed by a hard signal: the control is marked invalid or the page linked a message to it. */
export function countFlaggedFields(scan: FieldIssueScan): number {
  return scan.issues.filter((issue) => issue.invalid || issue.linkedMessages.length > 0).length;
}

function issueKey(issue: FieldIssue): string {
  return [issue.label, issue.role, ...issue.linkedMessages].join("\u0000");
}

/**
 * Fields a click flagged: marked invalid, or carrying a linked message the page
 * did not show before the click. A hint the page always links to a field
 * (aria-describedby help text) is not an answer the page rejected.
 */
export function countFlaggedSince(before: FieldIssueScan | null, after: FieldIssueScan): number {
  const earlier = new Set((before?.issues ?? []).map(issueKey));
  return after.issues.filter(
    (issue) => issue.invalid || (issue.linkedMessages.length > 0 && !earlier.has(issueKey(issue))),
  ).length;
}

/** Required fields that still show no answer. */
export function countRequiredEmpty(scan: FieldIssueScan): number {
  return scan.issues.filter((issue) => issue.required && !issue.value.trim()).length;
}

function noteKey(issue: FieldIssue, message: string): string {
  return [issue.label, issue.role, message].join("\u0000");
}

/**
 * Fields showing text beside them that was not there in `before` (the page as it
 * stood before the fill). A page that rejects an answer in plain copy, with no
 * ARIA and no invalid state, can only say so this way. Help text it showed all
 * along is not counted, and fields already flagged by a hard signal are counted
 * by countFlaggedSince instead. The Refill planner reads the text and decides
 * whether it is an error.
 */
export function countNotedSince(before: FieldIssueScan | null, after: FieldIssueScan): number {
  const earlier = new Set(
    (before?.issues ?? []).flatMap((issue) => issue.nearbyMessages.map((m) => noteKey(issue, m))),
  );
  return after.issues.filter(
    (issue) =>
      !issue.invalid &&
      issue.linkedMessages.length === 0 &&
      issue.nearbyMessages.some((message) => !earlier.has(noteKey(issue, message))),
  ).length;
}

/**
 * The fields a page flags, each carrying what the page shows about it, for Refill.
 * `answers` says whether a field answers the control an issue names. A field no
 * issue names is left out; an issue no field answers (a custom dropdown, whose
 * options exist only once opened) stays in the scan alone.
 */
export function flaggedFields(
  fields: FormField[],
  scan: FieldIssueScan,
  answers: (field: FormField, issue: FieldIssue) => boolean,
): FormField[] {
  const flagged: FormField[] = [];
  for (const field of fields) {
    const issues = scan.issues.filter((issue) => answers(field, issue));
    if (issues.length) flagged.push({ ...field, issue: issueNote(issues) });
  }
  return flagged;
}

function issueNote(issues: FieldIssue[]): FieldIssueNote {
  return {
    elementIndexes: issues.map((issue) => issue.elementIndex),
    value: issues.find((issue) => issue.value.trim())?.value ?? "",
    invalid: issues.some((issue) => issue.invalid),
    linkedMessages: [...new Set(issues.flatMap((issue) => issue.linkedMessages))],
    nearbyMessages: [...new Set(issues.flatMap((issue) => issue.nearbyMessages))],
  };
}
