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
  autocomplete?: string;
  placeholder?: string;
  name?: string;
  /** The control's native maxlength, when it sets one. */
  maxLength?: number;
  /** Short text the page shows after a text field: a character counter, a format hint. */
  notes?: string[];
  required: boolean;
  options?: string[];
}
