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
  vet: (sessionId: string) => `/agent/v1/sessions/${encodeURIComponent(sessionId)}/vet`,
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
  /** The server asks the person a question and waits: see AgentAsk. */
  ask: "ask",
} as const;

export type AgentStatus = (typeof AGENT_STATUS)[keyof typeof AGENT_STATUS];

/** Why a run ended without being done (mirrors acorn-agent's Stop* values). */
export const AGENT_STOP_REASON = {
  captcha: "captcha",
  verification: "verification",
  identity: "identity",
  document: "document",
  signIn: "sign_in",
  pageProblem: "page_problem",
  other: "other",
  noChange: "no_change",
  stepLimit: "step_limit",
  /** No job description was found, so no résumé was chosen, and the person chose to pick one. */
  resumeChoice: "resume_choice",
} as const;
export type AgentStopReason = (typeof AGENT_STOP_REASON)[keyof typeof AGENT_STOP_REASON];

/** One answer the person may give to a question the agent asks. */
export interface AgentAskOption {
  id: string;
  label: string;
}

/** A question the run waits on. The answer (an option id) goes back in the next observation. */
export interface AgentAsk {
  id: string;
  question: string;
  options: AgentAskOption[];
}

/** What the person is told when a run ends as need_person or stuck. */
export interface AgentStop {
  reason: AgentStopReason;
  /** What the page needs, or what went wrong, in plain words. */
  problem: string;
  /** What the person should do about it. */
  action: string;
}

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

/**
 * What the extension reads from the page about a control about to be clicked, or a window or
 * frame a click opened. The server's decision model judges it: a file only ever comes from this
 * computer, never an online service. Nothing here is a judgment.
 */
export interface AgentVetTarget {
  kind: "control" | "window" | "frame";
  tag?: string;
  type?: string;
  role?: string;
  text?: string;
  label?: string;
  title?: string;
  alt?: string;
  linkHost?: string;
  idClass?: string;
  /** The control sits in a component that holds a file input. */
  inFileComponent?: boolean;
  /** A window or frame: its address, title and the start of its text. */
  url?: string;
  windowTitle?: string;
  excerpt?: string;
  /** The page the click was on. */
  pageUrl?: string;
}

export interface AgentVetVerdict {
  blocked: boolean;
  probability: number;
  reason?: string;
}

/** What an action set off beyond itself, that a screenshot cannot show. */
export const ACTION_OPENED = {
  /** A click opened the browser's file picker, which the extension intercepts: no file was chosen. */
  filePicker: "file_picker",
} as const;
export type ActionOpened = (typeof ACTION_OPENED)[keyof typeof ACTION_OPENED];

export interface AgentActionResult {
  id: string;
  ok: boolean;
  error?: string;
  detail?: string;
  opened?: ActionOpened;
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
  /** The page's visible text, sent when it changed since the last step: the job description may be in it. */
  pageText?: string;
  /** The person's answer (an AgentAskOption id) to the question the last step asked. */
  answer?: string;
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
  /** Input tokens the provider served from its prompt cache. */
  cachedTokens?: number;
  /** Times the decision model checked the screen instead of the driving model; and what they cost (included in `cost`). */
  checks?: number;
  checkCost?: number;
}

export interface AgentStep {
  status: AgentStatus;
  message: string;
  /** Set when the run ended as need_person or stuck. */
  stop?: AgentStop;
  /** Set when the status is "ask": the question to put to the person. */
  ask?: AgentAsk;
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
