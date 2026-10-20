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
  locate: (sessionId: string) => `/agent/v1/sessions/${encodeURIComponent(sessionId)}/locate`,
  shots: (sessionId: string) => `/agent/v1/sessions/${encodeURIComponent(sessionId)}/shots`,
} as const;

/** Header that carries the person's OpenRouter key when the extension has one. */
export const AGENT_KEY_HEADER = "X-OpenRouter-Key";

/** Response headers: how long the server spent on a request (ms), and its clock then (unix ms). */
export const AGENT_HANDLER_MS_HEADER = "X-Agent-Handler-Ms";
export const AGENT_SERVER_TIME_HEADER = "X-Agent-Server-Time";
/** Where a response says its time went (the agent's wait on acorn-backend, and the backend's own steps). */
export const AGENT_SERVER_TIMING_HEADER = "Server-Timing";

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
  /** The agent's own, never the model's: take a picture of the page now and send it at once (a dropdown's list). */
  snap: "snap",
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
  /** When the action began (unix ms) and how long it took, for the log; the server ignores both. */
  startedAt?: number;
  ms?: number;
  /** Where the action's time went, by name (glide, click, settle, …), in ms. */
  laps?: Record<string, number>;
  error?: string;
  detail?: string;
  opened?: ActionOpened;
}

/**
 * A picture the extension sends while a batch of actions is still being carried out, so the agent can work
 * on it meanwhile: a zone's photo when its last action is done (reviewed on the side), or the photo of a
 * dropdown a `snap` action opened (probed).
 */
export interface AgentShotUpload {
  kind: "zone" | "snap";
  /** The survey screen of a zone photo. */
  zone?: number;
  /** The `snap` action a dropdown photo is of. */
  id?: string;
  screenshot: string;
  /** Where the page was scrolled to (screenshot pixels). */
  scrollY: number;
  /** What the page said had focus: a native list reports its options as text. */
  focus?: AgentFocus | null;
}

/**
 * Where is the target of this action now? The page changed shape since the survey, so the extension
 * sends a screenshot taken at the window's place and the agent finds the target by its anchor.
 */
export interface AgentLocate {
  actionId: string;
  screenshot: string;
  /** Where the page was scrolled to when the screenshot was taken (screenshot pixels). */
  scrollY: number;
}

/** The answer: the target's point in the screenshot's pixels, or why it was not found. */
export interface AgentLocated {
  found: boolean;
  x?: number;
  y?: number;
  score?: number;
  reason?: string;
}

/** The parts of a page the model will not come back to (painted blue on the minimap), in screenshot pixels from its top. */
export interface AgentSettledMap {
  /** How tall the page was when they were settled; when it is a different height only the parts above `fence` hold. */
  pageHeight: number;
  /**
   * How far down the page the plan being carried out leaves things as they are: where it first acts. Above
   * it nothing the run does can move or change anything, so what is settled there is not forgotten when a
   * form below it grows or shrinks.
   */
  fence: number;
  spans: { from: number; to: number }[];
}

/** The screenshot taken when the last action of a zone of a plan was done (fast fill, docs 19.4m). */
export interface AgentZoneShot {
  /** The survey screen the actions of the zone were measured on, from 1. */
  zone: number;
  screenshot: string;
  /** Where the page was scrolled to (screenshot pixels). */
  scrollY: number;
}

/** One screenshot of a survey: the page scrolled to `scrollY` (screenshot pixels). */
export interface AgentSurveyScreen {
  screenshot: string;
  scrollY: number;
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
  /** Photos of the zones of the plan just carried out, each taken when its zone was done (fast fill). */
  zoneShots?: AgentZoneShot[];
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
  /**
   * The scroll position (screenshot pixels) the page must be at before this action, because its
   * point was measured on that screen of a survey; `pageHeight` is the page's height then, so the
   * extension can refuse when the page has changed shape since.
   */
  scrollTo?: number;
  pageHeight?: number;
  /**
   * Fast fill: the survey screen this action belongs to. The extension takes a photo when the last
   * action of a zone is done and sends it with the next look.
   */
  zone?: number;
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
  /** The parts of the page the model will not come back to, sent when they change; an empty list means none. */
  settled?: AgentSettledMap;
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
  /**
   * Fast fill: plan a whole page at once and carry it out zone by zone, with the checks done on the side
   * (docs 19.4m). Off, the run goes step by step as before. Phase 0 only carries the switch.
   */
  fastFill?: boolean;
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
  /** What the run really uses: the server may turn them on for every run, and a fast-fill run surveys. */
  fastFill?: boolean;
  survey?: boolean;
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
} as const;

/** The error body every failing route sends. */
export interface AgentErrorBody {
  error: string;
  code: string;
}
