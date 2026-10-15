/** Plan and run contracts for the extension's fill pipeline. */

export type PlanActionType =
  | "fill"
  | "clear"
  | "upload"
  | "resume_upload"
  | "select_radio"
  | "wait"
  | "validate"
  | "pause_for_review"
  | "forbidden";

export type PlanStepActionType =
  | "fill"
  | "clear"
  | "upload"
  | "resume_upload"
  | "select_radio"
  | "wait"
  | "validate"
  | "verify_only";

export interface PlanAction {
  action: PlanActionType;
  element_index: number | null;
  element_indexes: number[] | null;
  expected_label: string | null;
  expected_role: string | null;
  value: string | null;
  file: string | null;
  reason: string | null;
  ms: number | null;
  /** The choice group the action answers (FormField.group), set by the run from its field list. */
  expected_group?: string | null;
  /**
   * An upload for a field the form requires: the file to give instead when the one
   * named in `file` is not available (a required cover-letter field and no letter in
   * the Library gets the résumé). Absent on an optional field, which is left alone.
   */
  fallback_file?: string | null;
}

export interface ActionPlan {
  goal: string;
  actions: PlanAction[];
  forbidden_actions: PlanAction[];
  validation: {
    required_element_indexes: number[];
    stop_before_submit: boolean;
  };
  unresolved_items: string[];
  /** Required fields the run could not answer (their question was never on the page). */
  unanswerable?: { element_index: number; label: string; reason: string }[];
}

export interface RuntimeAttachedFile {
  key: string;
  name: string;
  mimeType: string;
  base64: string;
  /** Library stack label for UI (e.g. folder title). */
  label?: string | null;
  /** Library row id assigned to this job. */
  resumeId?: string | null;
  /** Worker pool job this file was fetched for. */
  jobId?: string | null;
  /** The file's format: pdf, docx, doc, or txt. */
  format?: string | null;
  /** resume or cover_letter. */
  kind?: string | null;
  /**
   * The same stack in its other formats, preferred first. An upload field that
   * takes only one format gets that one; the file itself is the preferred one.
   */
  variants?: RuntimeAttachedFile[];
}

export interface PlanStepPayload {
  action: PlanStepActionType;
  element_index: number | null;
  element_indexes: number[] | null;
  expected_label: string | null;
  expected_role: string | null;
  value: string | null;
  file?: RuntimeAttachedFile | null;
  ms: number | null;
  /** Refill: act even when the control already shows the value, since the page rejected it. */
  force?: boolean;
  /** The choice group the plan named: the step never answers another group's question. */
  expected_group?: string | null;
}

export interface PlanStepResult {
  ok: boolean;
  verified?: boolean;
  acted?: boolean;
  /** True when the control already had the intended value. */
  alreadyFilled?: boolean;
  error?: string;
  details?: {
    nodeId?: number;
    matchedLabel?: string;
    matchedRole?: string;
    valueAfter?: string;
  };
}

export type PauseDecision = "continue" | "skip" | "abort";

/** What a step says when the page no longer holds the element the plan named. */
export const ELEMENT_NOT_FOUND = "Element not found for index";

/**
 * Whether the plan was made for a page that is gone: every step failed because its
 * element is no longer there. The page was replaced under the plan; planning it again on
 * the page that is there is not a retry of the same answers.
 */
export function planTargetsGone(steps: ReadonlyArray<{ message?: string }>): boolean {
  return steps.length > 0 && steps.every((step) => step.message?.startsWith(ELEMENT_NOT_FOUND));
}

export type RunStepStatus =
  "pending" | "running" | "ok" | "paused" | "skipped" | "blocked" | "failed" | "aborted";

export interface RunStepRecord {
  index: number;
  action: string;
  element_index: number | null;
  expected_label: string | null;
  status: RunStepStatus;
  message?: string;
}

export interface PauseRequest {
  index: number;
  action: string;
  element_index: number | null;
  expected_label: string | null;
  reason: string;
  kind: "planned" | "error";
}

export interface RunReport {
  ok: boolean;
  aborted: boolean;
  steps: RunStepRecord[];
  summary: {
    ok: number;
    skipped: number;
    blocked: number;
    failed: number;
    paused: number;
  };
}
