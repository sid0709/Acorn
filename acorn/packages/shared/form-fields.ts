/** Fast fill contract: the page's fields as the decision-model planner reads them. */

/** ai-analyze mode for the decision-model planner (the text model only writes prose). */
export const FAST_PLAN_MODE = "fast";

export type FormFieldKind =
  "text" | "textarea" | "select" | "radio" | "checkbox" | "toggle" | "buttons" | "file";

/**
 * One control the page shows. Choice kinds carry their options; the planner picks
 * among them directly. Text kinds carry only what names the field — the planner
 * maps them to a profile fact, a written answer, or blank.
 */
export interface FormField {
  /** Pure Tree node id; the plan's element_index. */
  elementIndex: number;
  kind: FormFieldKind;
  label: string;
  /** The heading of the form section the field sits in ("References", "Education"). */
  section?: string;
  inputType?: string;
  /** A file input's own list of the file types it takes (".pdf,application/pdf"). */
  accept?: string;
  autocomplete?: string;
  placeholder?: string;
  name?: string;
  /**
   * The control's own id, as the page names it (`workHistory.startDate.0`). Passed on as plain
   * data: what a page calls its control often says which entry or part of the form it is.
   */
  identifier?: string;
  /** The control's native maxlength, when it sets one. */
  maxLength?: number;
  /** Short text the page shows after a text field: a character counter, a format hint. */
  notes?: string[];
  required: boolean;
  /**
   * A choice field's identity on the page (the radio group's name, scoped to its form),
   * which a step carries so it is never acted on in another group.
   */
  group?: string;
  options?: string[];
  /**
   * The page holds its forward control disabled while this field is unanswered
   * or unchecked: it may be what the page is waiting for.
   */
  blocking?: boolean;
  /** Refill only: what the page shows about this field, which it flags. */
  issue?: FieldIssueNote;
}

/** One earlier answer to a flagged field, and how its step went. */
export interface FieldAttempt {
  value: string;
  result: string;
}

/**
 * What the page shows about a field it flags, gathered from every issue the field
 * answers (see @acorn/shared/field-issues): those issues' ids, the answer the field
 * holds now, whether the page marks it invalid, and the messages it ties to the
 * field or shows beside it.
 */
export interface FieldIssueNote {
  /** Answers an earlier round gave this field that the page still flags, with how each step went. */
  attempts?: FieldAttempt[];
  elementIndexes: number[];
  value: string;
  invalid: boolean;
  linkedMessages: string[];
  nearbyMessages: string[];
}
