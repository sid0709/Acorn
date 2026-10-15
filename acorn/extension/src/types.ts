import type { FieldIssueScan } from "@acorn/shared/field-issues";
import type { FormField } from "@acorn/shared/form-fields";
import type { RuntimeAttachedFile } from "@acorn/shared/plan-runner/types";

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
  /** Fields of the frame's page itself, outside any layer laid over it (a consent panel, a dialog). */
  pageScore?: number;
  /** Refill only: fields the page flags, keyed by this tree's node ids. */
  fieldIssues?: FieldIssueScan;
  /** Fast fill only: the page's fields, keyed by this tree's node ids. */
  formFields?: FormField[];
  /** Asked for after an opening click: what it drew, keyed by this tree's node ids. */
  scope?: OpenScope | null;
  /** Where the page's own time went while it answered this read. */
  timings?: DomReadTimings;
  /**
   * The other frames of the tab that answered this read, when no frame held a form: the page
   * lives in whichever frame carries its copy, and what the others say (a banner, a message)
   * is part of what the page says. Their node ids are their own: only text is read from them.
   */
  otherFrames?: { frameId: number; url: string; title: string; tree: DomNode }[];
}

/** Milliseconds a frame spent on each part of one read, logged with the read. */
export interface DomReadTimings {
  /** Waiting for the form to draw (an app still hydrating). */
  formWaitMs: number;
  serializeMs: number;
  issuesMs: number;
  fieldsMs: number;
}

/** What a click drew inside the page (an entry form, a dialog), as one read sees it. */
export interface OpenScope {
  /** Node ids, in this read's numbering, of the controls the scope drew (its save, its cancel). */
  controlIds: number[];
  /** Fields the scope asks. */
  fields: number;
  /** What the page calls it: its heading, or the section it opened in. */
  title: string;
}

/** Where a scope stands after the run tried to save it. */
export interface ScopeState {
  /** Its fields still show: the page has not taken it yet. */
  open: boolean;
  fields: number;
  /** Labels of its fields the page flags or that still need an answer. */
  issues: string[];
}

/** Long-lived side-panel port. Keeps the MV3 worker (and `/acorn/socket.io` socket) alive. */
export const ACORN_SIDEBAR_PORT = "acorn-sidebar";

/** Background waits this long for a plan-step reply; option matching can be slow. */
export const PLAN_STEP_TIMEOUT_MS = 120_000;
/** The page gives up first so its error, not a channel timeout, reaches the background. */
export const PLAN_STEP_PAGE_TIMEOUT_MS = PLAN_STEP_TIMEOUT_MS - 5_000;

/** Socket.IO events the server sends this extension (same strings as acornapi/gateway). */
export const SOCKET_EVENT = {
  /** One AI call was recorded: `{ tab, entry }`, tab being the usage key it belongs to. */
  aiUsageRecorded: "ai-usage:recorded",
  /** A new message, from either side, on one of this account's reports: `{ claim, message }`. */
  supportMessage: "support:message",
  /** Support opened or closed one of this account's reports: `{ claim }`. */
  supportClaim: "support:claim",
} as const;

export const MSG = {
  FETCH_DOM: "acorn:fetch-dom",
  FETCH_AND_EMIT_DOM: "acorn:fetch-and-emit-dom",
  HIGHLIGHT: "acorn:highlight",
  CLEAR_HIGHLIGHT: "acorn:clear-highlight",
  GET_CONTENT: "acorn:get-content",
  EXECUTE_ACTIONS: "acorn:execute-actions",
  PLAN_STEP: "acorn:plan-step",
  MATCH_OPTION: "acorn:match-option",
  /** A field that refused a script's value: type it with the browser's own input events. */
  TYPE_TRUSTED: "acorn:type-trusted",
  /** A long dropdown with no planned answer: ask the writer for one to type as a search. */
  ESTIMATE_OPTION: "acorn:estimate-option",
  FILL_LEFTOVER_COMBOS: "acorn:fill-leftover-combos",
  /** List planned choice fields that still need a decision (after uploads finish). */
  COLLECT_CHOICES: "acorn:collect-choices",
  /** Re-read field errors on the last serialized tree (Refill's after-check). */
  SCAN_FIELD_ISSUES: "acorn:scan-field-issues",
  /** Put back answers the page cleared after a fill (an import, a reset), with no model call. */
  REPAIR_DRIFT: "acorn:repair-drift",
  /** A cheap look at the page while a click settles (see PageProbe). */
  PAGE_PROBE: "acorn:page-probe",
  /** Sidebar → service worker: reconcile one tab's AI usage with the server's list. */
  REFRESH_TAB_USAGE: "acorn:refresh-tab-usage",
  /** Sidebar → service worker: full-page screenshot of the active tab, filed with notes as a support claim. */
  SUBMIT_SUPPORT_CLAIM: "acorn:submit-support-claim",
  /** Service worker → sidebar: a report changed on the server; `payload` is the socket event's. */
  SUPPORT_CLAIMS_CHANGED: "acorn:support-claims-changed",
  /** Content script on the Acorn site → service worker: a support sign-in code to redeem. */
  SUPPORT_HANDOFF: "acorn:support-handoff-relay",
  /** Press one control the Run orchestrator picked from the tree. */
  CLICK_CONTROL: "acorn:click-control",
  /** Remember the page right before a click that may open something inside it (see scope.ts). */
  SCOPE_CENSUS: "acorn:scope-census",
  /** Where what the click opened stands: still showing, and what it still needs. */
  SCOPE_STATE: "acorn:scope-state",
  /** What the click opened is done with; `committed` when the page took it. */
  SCOPE_END: "acorn:scope-end",
  START_PIPELINE: "acorn:start-pipeline",
  /** Run: recommend, fill, advance, and refill until the application is done. */
  START_RUN: "acorn:start-run",
  /** Sidebar → service worker: stop the Run working on this tab, at once. */
  STOP_RUN: "acorn:stop-run",
  PIPELINE_PROGRESS: "acorn:pipeline-progress",
  /** Page → service worker: answer after `ms`, timed where a hidden tab cannot slow it. */
  PAGE_DELAY: "acorn:page-delay",
  SOCKET_STATUS: "acorn:socket-status",
  OPERATOR_NOTICE: "acorn:operator-notice",
  AUTH_STATUS: "acorn:auth-status",
  AUTH_SIGNIN: "acorn:auth-signin",
  AUTH_SIGNOUT: "acorn:auth-signout",
  LIST_WORKER_JOBS: "acorn:list-worker-jobs",
  OPEN_WORKER_JOB: "acorn:open-worker-job",
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
  /** Notices sharing an id replace each other on screen instead of stacking. */
  id?: string;
  kind: AcornNoticeKind;
  title: string;
  detail?: string;
  /**
   * When set, the toast belongs to that Chrome tab: it shows only while the tab
   * is focused, and leaves when the person switches to another tab.
   * Omit it for account and connection notices, which stay up in every tab.
   */
  tabId?: number;
};

export type PipelineSource = "fill" | "custom";

export interface MatchOptionRequest {
  intendedValue: string;
  options: string[];
  fieldLabel?: string | null;
  typedQuery?: string | null;
  /** The list may be partial (a search box can show more), so "not listed" is a valid answer. */
  allowNotListed?: boolean;
  /**
   * With allowNotListed: these are all the options there are. "Not listed" then
   * means no option is the answer, and a specific fact is never swapped for another.
   */
  listComplete?: boolean;
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

/** One definition, in the shared plan runner: a file a plan step attaches. */
export type { RuntimeAttachedFile };

/** What a click's settle loop compares between polls, without serializing the page. */
export interface PageProbe {
  url: string;
  /** Hash of the fields the page asks for (never their values). */
  fields: string;
  /** Visible fields marked invalid plus visible alerts. */
  refusals: number;
  /** Clickable controls in the document: grows while an app renders. */
  controls: number;
  /** Length of the visible text: grows while an app renders. */
  textLength: number;
  /** The page says it is still working: a document still loading, a busy region, a progress indicator. */
  loading: boolean;
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
  /**
   * The choice group the plan named (FormField.group). The control a step resolves to,
   * and the control it acts on, must belong to it; a step never answers another question.
   */
  expected_group?: string | null;
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
