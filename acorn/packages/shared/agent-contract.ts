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
  continue: (sessionId: string) => `/agent/v1/sessions/${encodeURIComponent(sessionId)}/continue`,
  memory: (sessionId: string) => `/agent/v1/sessions/${encodeURIComponent(sessionId)}/memory`,
  prefill: (sessionId: string) => `/agent/v1/sessions/${encodeURIComponent(sessionId)}/prefill`,
  review: (sessionId: string) => `/agent/v1/sessions/${encodeURIComponent(sessionId)}/review`,
  advance: (sessionId: string) => `/agent/v1/sessions/${encodeURIComponent(sessionId)}/advance`,
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
  /** Loads the page again at its address: for a page that shows an error or stopped loading. */
  reload: "reload",
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
  /** A code the site emailed the applicant. */
  verification: "verification",
  /** A link in an email the applicant must open. */
  verificationLink: "verification_link",
  identity: "identity",
  document: "document",
  signIn: "sign_in",
  /** The site refused the sign-in, the new account and the password reset. */
  accountRejected: "account_rejected",
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

/** Why the agent refused a click or closed a window: the thing it reached. */
export const VET_CAUSE = {
  onlineSource: "online_source",
  singleSignOn: "single_sign_on",
} as const;
export type VetCause = (typeof VET_CAUSE)[keyof typeof VET_CAUSE];

export interface AgentVetVerdict {
  blocked: boolean;
  probability: number;
  cause?: VetCause;
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

/** One screenshot of a survey: the page scrolled to `scrollY` (screenshot pixels). */
export interface AgentSurveyScreen {
  screenshot: string;
  scrollY: number;
}

/** What a fill of the quick text pass does to its field (acorn-agent's Fill* values; Oak's plan actions). */
export const PREFILL_ACTION = {
  /** Types the value into a text box, or chooses it in a native list. */
  fill: "fill",
  /** Picks the option of a radio group or a checkbox group that reads as the value. */
  selectRadio: "select_radio",
} as const;
export type PrefillAction = (typeof PREFILL_ACTION)[keyof typeof PREFILL_ACTION];

/** The page the run is on, serialized as Oak's "pure tree": lines of `tag[id] attributes "text"`. */
export interface AgentPrefillRequest {
  url: string;
  title: string;
  tree: string;
}

export interface AgentPrefillFill {
  /** The element's number in the tree. */
  ref: number;
  action: PrefillAction;
  /** The question the field answers, as the model read it from the page. */
  label?: string;
  /** What kind of control the model took it for ("textbox", "radio", "checkbox"). */
  role?: string;
  /** The text to type, or the option's own wording for a list or a group. */
  value?: string;
  /** The value is the account password: typed, never logged or shown. */
  secret?: boolean;
}

export interface AgentPrefillPlan {
  fills: AgentPrefillFill[] | null;
  dropped?: string[];
  usage: AgentUsage;
  trace?: AgentTrace;
}

/** One field in a report: its label, and what was typed or why it was not. */
export interface AgentPrefillLine {
  label: string;
  value?: string;
  error?: string;
}

/** What the extension did with a plan; the model is told it at its next look. */
export interface AgentPrefillReport {
  filled?: AgentPrefillLine[];
  failed?: AgentPrefillLine[];
}

/** What the page says of itself after the first draft (acorn-agent's ReviewFindings). */
export interface AgentReviewFindings {
  /** How many plain fields the page shows; 0 means it is not a form. */
  fields: number;
  /** Labels of required fields still empty. */
  empty?: string[];
  /** Visible error messages, and the labels of fields the page marked invalid. */
  errors?: string[];
  /** Labels of fills the pass made that did not take. */
  failed?: string[];
  /** Disabled controls that would continue the application, and, with one, the unticked boxes of its form. */
  blocked?: string[];
}

export interface AgentReviewRequest {
  url: string;
  title: string;
  screenshot: string;
  viewport: AgentViewport;
  dom: AgentReviewFindings;
  /** The whole page as screenshots, when it is taller than the screen and the page's own state found nothing wrong. */
  survey?: AgentSurveyScreen[];
}

/** What a review made of the page. */
export const REVIEW_VERDICT = {
  /** Every required field is answered and nothing is in the way: the page may go on. */
  clean: "clean",
  /** Something is left to do or went wrong; `problems` says what. */
  fix: "fix",
  /** The page is still changing: look again in a moment. */
  loading: "loading",
  /** The screen shows the application was received. */
  sent: "sent",
  /** Only the applicant's own hand can go on: `step` ends the run as need_person. */
  human: "human",
  /** The review could not decide: the driving model looks. */
  look: "look",
} as const;
export type ReviewVerdict = (typeof REVIEW_VERDICT)[keyof typeof REVIEW_VERDICT];

export interface AgentReviewResult {
  verdict: ReviewVerdict;
  problems?: string[];
  /** What the driving model is told on its next look; absent when it needs none. */
  note?: string;
  step?: AgentStep;
  usage: AgentUsage;
  trace?: AgentTrace;
}

/** One control of the page that could be pressed, as the page words it. */
export interface AgentAdvanceCandidate {
  ref: number;
  text: string;
  kind: "button" | "submit";
  inForm?: boolean;
}

export interface AgentAdvanceRequest {
  url: string;
  title: string;
  screenshot: string;
  candidates: AgentAdvanceCandidate[];
  /** The whole page as screenshots, so a control below the screen can be seen and chosen. */
  survey?: AgentSurveyScreen[];
  viewport: AgentViewport;
}

/** What to do about a page that reviewed clean. */
export const ADVANCE_ACTION = {
  click: "click",
  /** The control that sends the application was found and the run is to stop before it. */
  readyToSubmit: "ready_to_submit",
  none: "none",
} as const;
export type AdvanceAction = (typeof ADVANCE_ACTION)[keyof typeof ADVANCE_ACTION];

export interface AgentAdvanceResult {
  action: AdvanceAction;
  ref?: number;
  text?: string;
  /** The control sends the application rather than moving to another step. */
  submit?: boolean;
  /** How sure the decision model was of the pick, and that no control continues. */
  sure?: number;
  none?: number;
  step?: AgentStep;
  usage: AgentUsage;
  trace?: AgentTrace;
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
  /** The whole page as screenshots from top to bottom, sent on the first look of a page and when asked for. */
  survey?: AgentSurveyScreen[];
  /** The page's visible text, sent when it changed since the last step: the job description may be in it. */
  pageText?: string;
  /** The person's answer (an AgentAskOption id) to the question the last step asked. */
  answer?: string;
  /** What the quick text pass did on this page since the model last looked. */
  prefill?: AgentPrefillReport;
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
  /**
   * The scroll position (screenshot pixels) the page must be at before this action, because its
   * point was measured on that screen of a survey; `pageHeight` is the page's height then, so the
   * extension can refuse when the page has changed shape since.
   */
  scrollTo?: number;
  pageHeight?: number;
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
  /** Make the next look a survey of the whole page. */
  survey?: boolean;
  actions: AgentAction[] | null;
  number: number;
  usage: AgentUsage;
  dropped?: string[];
  /** The trace of what the server recorded since the last answer, when the run asked for it. */
  trace?: AgentTrace;
}

/** One file of a run's trace the server made: text in `text`, an image as base64 in `data`. */
export interface AgentTraceFile {
  name: string;
  text?: string;
  data?: string;
}

/**
 * What the server adds to the trace (the files a trace folder holds: the model's prompt and answer,
 * how long each call took, the screenshot with the actions drawn on it). The server keeps none of it.
 */
export interface AgentTrace {
  /** The entry the answer is for, as its files are numbered (001.json); absent at the run's start. */
  seq?: number;
  files: AgentTraceFile[];
  /** This entry's line of the run's timeline. */
  timeline?: string;
}

export interface AgentStart {
  url: string;
  title: string;
  stopBeforeSubmit: boolean;
  /** Return the run's trace in the answers, for the extension to keep in its own log. */
  trace?: boolean;
  /** Let the run survey a long page (several screenshots from top to bottom). Off: it sees the current screen only. */
  survey?: boolean;
  /** Let the extension send the page's plain fields for a quick text pass before the model looks. */
  prefill?: boolean;
  /** What a stopped run knew, to start a run that goes on from it when the server forgot the session. */
  memory?: AgentMemory;
}

/**
 * The part of a run that is costly to find again and does not depend on its step history: the
 * notes and job the model recorded, the job description read from the page, the résumé chosen
 * from it, and whether the application form was already found. The extension keeps it when a run
 * stops, so Continue goes on from it even when the agent's session is gone.
 */
export interface AgentMemory {
  memo?: string;
  job?: string;
  jd?: string;
  resume?: string;
  formReady?: boolean;
}

export interface AgentResumeInfo {
  id: string;
  fileName: string;
  size: number;
}

export interface AgentStarted {
  sessionId: string;
  resumes: AgentResumeInfo[];
  /** The run's start (session.json, system.txt), when the run asked for the trace. */
  trace?: AgentTrace;
}

/** A stopped run taken back up: the step it was at and what it has spent, so the counters go on. */
export interface AgentContinued {
  number: number;
  usage: AgentUsage;
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
  /** The person's Acorn session is missing or expired: the agent reads their profile from acorn-backend. */
  signedOut: "signed_out",
  /** acorn-backend could not be reached from the agent. */
  backendUnreachable: "backend_unreachable",
  badFallbackResume: "bad_fallback_resume",
  /** The quick text pass was refused: the page was unusable, or the run may make no more. */
  badPrefill: "bad_prefill",
  prefillUnavailable: "prefill_unavailable",
  /** The model's own plan is still being carried out: ask again at a later look. */
  prefillBusy: "prefill_busy",
} as const;

/** The error body every failing route sends. */
export interface AgentErrorBody {
  error: string;
  code: string;
}
