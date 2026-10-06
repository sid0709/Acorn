import type { FieldIssueScan } from "@acorn/shared/field-issues";
import type { FormField } from "@acorn/shared/form-fields";

export interface DomNode {
  nodeId: number;
  tag: string;
  id?: string;
  classes?: string[];
  attrs?: Record<string, string>;
  text?: string;
  childCount: number;
  children: DomNode[];
}

export interface DomTreePayload {
  url: string;
  title: string;
  tree: DomNode;
  fetchedAt: string;
  tabId?: number;
  frameId?: number;
  /** Fillable control count used to pick the form frame among iframes. */
  formScore?: number;
  /** Debug builds only: the form frame's HTML, for the backend debug run. */
  html?: string;
  /** Refill only: fields the page flags, keyed by this tree's node ids. */
  fieldIssues?: FieldIssueScan;
  /** Fast fill only: the page's fields, keyed by this tree's node ids. */
  formFields?: FormField[];
}

/** Long-lived side-panel port. Keeps the MV3 worker (and `/acorn/socket.io` socket) alive. */
export const ACORN_SIDEBAR_PORT = "acorn-sidebar";

/** Background waits this long for a plan-step reply; option matching can be slow. */
export const PLAN_STEP_TIMEOUT_MS = 120_000;
/** The page gives up first so its error, not a channel timeout, reaches the background. */
export const PLAN_STEP_PAGE_TIMEOUT_MS = PLAN_STEP_TIMEOUT_MS - 5_000;

export const MSG = {
  FETCH_DOM: "acorn:fetch-dom",
  FETCH_AND_EMIT_DOM: "acorn:fetch-and-emit-dom",
  HIGHLIGHT: "acorn:highlight",
  CLEAR_HIGHLIGHT: "acorn:clear-highlight",
  GET_CONTENT: "acorn:get-content",
  EXECUTE_ACTIONS: "acorn:execute-actions",
  PLAN_STEP: "acorn:plan-step",
  MATCH_OPTION: "acorn:match-option",
  /** A long dropdown with no planned answer: ask the writer for one to type as a search. */
  ESTIMATE_OPTION: "acorn:estimate-option",
  FILL_LEFTOVER_COMBOS: "acorn:fill-leftover-combos",
  /** List planned choice fields that still need a decision (after uploads finish). */
  COLLECT_CHOICES: "acorn:collect-choices",
  /** Re-read field errors on the last serialized tree (Refill's after-check). */
  SCAN_FIELD_ISSUES: "acorn:scan-field-issues",
  START_PIPELINE: "acorn:start-pipeline",
  PIPELINE_PROGRESS: "acorn:pipeline-progress",
  SOCKET_STATUS: "acorn:socket-status",
  OPERATOR_NOTICE: "acorn:operator-notice",
  AUTH_STATUS: "acorn:auth-status",
  AUTH_SIGNIN: "acorn:auth-signin",
  AUTH_SIGNOUT: "acorn:auth-signout",
  LIST_WORKER_JOBS: "acorn:list-worker-jobs",
  OPEN_WORKER_JOB: "acorn:open-worker-job",
  MARK_JOB_APPLIED: "acorn:mark-job-applied",
  GET_TAB_JOB: "acorn:get-tab-job",
  REMEMBER_CUSTOM_TAB: "acorn:remember-custom-tab",
  FORGET_CUSTOM_TAB: "acorn:forget-custom-tab",
  FOCUS_CUSTOM_TAB: "acorn:focus-custom-tab",
  START_CUSTOM_GENERATE: "acorn:start-custom-generate",
  START_CUSTOM_RECOMMEND: "acorn:start-custom-recommend",
  START_JOB_GENERATE: "acorn:start-job-generate",
  START_JOB_RECOMMEND: "acorn:start-job-recommend",
  SELECTION_QA: "acorn:selection-qa",
  /** Debug builds only: a page trace event relayed to the backend debug run. */
  DEBUG_TRACE: "acorn:debug-trace",
} as const;

export type AcornNoticeKind = "error" | "success" | "info";

export type AcornNoticePayload = {
  kind: AcornNoticeKind;
  title: string;
  detail?: string;
};

export type PipelineSource = "fill" | "custom";

export interface MatchOptionRequest {
  intendedValue: string;
  options: string[];
  fieldLabel?: string | null;
  typedQuery?: string | null;
  /** The list may be partial (a search box can show more), so "not listed" is a valid answer. */
  allowNotListed?: boolean;
  /** A checkbox group: the answer is every option to check. */
  multiple?: boolean;
}

/** SelectorGateway (TypeSafe Jev) pick for one dropdown. */
export interface MatchOptionResponse {
  ok?: boolean;
  /** null only when allowNotListed was set and the answer is not in this list. */
  matched_option?: string | null;
  /** The best listed option even when matched_option is null. */
  fallback_option?: string | null;
  /** `multiple` requests: every option to check. */
  matched_options?: string[];
  confidence?: number;
  reason?: string;
  error?: string;
  model?: string;
  usage?: import("@acorn/shared/ai-usage").AiUsageSummary;
}

export type PlanStepActionType =
  | "fill"
  | "clear"
  | "upload"
  | "resume_upload"
  | "select_radio"
  | "wait"
  | "validate"
  | "verify_only";

export interface RuntimeAttachedFile {
  key: string;
  name: string;
  mimeType: string;
  base64: string;
  label?: string | null;
  resumeId?: string | null;
  jobId?: string | null;
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
}

export interface PlanStepSocketPayload {
  tabId: number;
  url: string;
  extensionId?: string;
  frameId?: number | null;
  step: PlanStepPayload;
}

export interface PlanStepResult {
  ok: boolean;
  verified?: boolean;
  acted?: boolean;
  /** True when the control already had the intended value (do not confuse with frame `skipped`). */
  alreadyFilled?: boolean;
  error?: string;
  details?: {
    nodeId?: number;
    matchedLabel?: string;
    matchedRole?: string;
    valueAfter?: string;
  };
}

export interface HighlightPayload {
  nodeId: number;
  tabId: number;
  url: string;
}

export interface GetContentPayload {
  nodeId: number;
  tabId: number;
  contentType: "innerHTML" | "innerText";
}

export interface ActionStep {
  type: "focus" | "click" | "type" | "wait" | "keydown" | "keyup";
  text?: string;
  ms?: number;
  key?: string;
}

export interface ExecuteActionsPayload {
  nodeId: number;
  tabId: number;
  steps: ActionStep[];
}

export type SelectionQaResponse = {
  ok: boolean;
  answer?: string;
  error?: string;
};
