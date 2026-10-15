/**
 * What the extension and the agent server (acorn-agent) say to each other. The extension is
 * the agent's eyes and hands: it sends a screenshot, the server answers with the next
 * physical actions, and the extension performs them. The same shapes are the Go types in
 * acorn-agent/agent/protocol.go.
 */

/** Routes of the agent server, under its host. */
export const AGENT_ROUTES = {
  health: "/agent/v1/health",
  sessions: "/agent/v1/sessions",
  step: (sessionId: string) => `/agent/v1/sessions/${encodeURIComponent(sessionId)}/step`,
  resume: (sessionId: string, resumeId: string) =>
    `/agent/v1/sessions/${encodeURIComponent(sessionId)}/resume?id=${encodeURIComponent(resumeId)}`,
  session: (sessionId: string) => `/agent/v1/sessions/${encodeURIComponent(sessionId)}`,
} as const;

/** Header that carries the person's OpenRouter key when the extension has one. */
export const AGENT_KEY_HEADER = "X-OpenRouter-Key";

/** Every action is something a person does with a mouse and keyboard. */
export const ACTION_KIND = {
  click: "click",
  doubleClick: "double_click",
  tripleClick: "triple_click",
  rightClick: "right_click",
  hover: "hover",
  type: "type",
  key: "key",
  scroll: "scroll",
  upload: "upload",
  wait: "wait",
} as const;

export type ActionKind = (typeof ACTION_KIND)[keyof typeof ACTION_KIND];

/** What the server says the run does next. */
export const AGENT_STATUS = {
  working: "working",
  done: "done",
  needPerson: "need_person",
  stuck: "stuck",
} as const;

export type AgentStatus = (typeof AGENT_STATUS)[keyof typeof AGENT_STATUS];

/** The screenshot's size and the page behind it; every action coordinate is in screenshot pixels. */
export interface AgentViewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  pageWidth: number;
  pageHeight: number;
}

/** What the page reports about the control that has keyboard focus. */
export interface AgentFocus {
  tag: string;
  type?: string;
  label?: string;
  value?: string;
  checked?: boolean;
  options?: string[];
  multiple?: boolean;
  required?: boolean;
  invalid?: string;
}

export interface AgentActionResult {
  id: string;
  ok: boolean;
  error?: string;
  detail?: string;
}

export interface AgentObservation {
  /** A data URL of the visible page. */
  screenshot: string;
  url: string;
  title: string;
  viewport: AgentViewport;
  focus?: AgentFocus | null;
  notes?: string[];
  results?: AgentActionResult[];
}

export interface AgentAction {
  id: string;
  kind: ActionKind;
  x?: number;
  y?: number;
  text?: string;
  /** Typed text is a password or a code: it never appears in a log. */
  secret?: boolean;
  keys?: string;
  dx?: number;
  dy?: number;
  ms?: number;
  /** A résumé id from the session's list, chosen by the server for an upload. */
  resume?: string;
  fileName?: string;
}

export interface AgentUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface AgentStep {
  status: AgentStatus;
  message: string;
  actions: AgentAction[] | null;
  number: number;
  usage: AgentUsage;
  dropped?: string[];
}

export interface AgentStart {
  url: string;
  title: string;
  stopBeforeSubmit: boolean;
}

export interface AgentResumeInfo {
  id: string;
  fileName: string;
  size: number;
}

export interface AgentStarted {
  sessionId: string;
  resumes: AgentResumeInfo[];
}

/** The server's stable codes beside an error (acorn-agent/httpapi and llm). */
export const AGENT_ERROR_CODE = {
  noKey: "no_key",
  invalidKey: "invalid_key",
  noCredits: "no_credits",
  rateLimited: "rate_limited",
  badRequest: "bad_request",
  modelError: "model_error",
  network: "network",
  cancelled: "cancelled",
  noSession: "no_session",
  runOver: "run_over",
  badObservation: "bad_observation",
  noProfile: "no_profile",
  noResume: "no_resume",
  badJson: "bad_json",
} as const;

/** The error body every failing route sends. */
export interface AgentErrorBody {
  error: string;
  code: string;
}
