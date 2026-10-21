/** Run: one click that recommends, fills, advances, and refills until the application is done. */

import type { AiUsageSummary } from "./ai-usage";

/** What the orchestrator is doing right now. */
export const RUN_STAGE = {
  reading: "reading",
  recommending: "recommending",
  applying: "applying",
  filling: "filling",
  advancing: "advancing",
  refilling: "refilling",
  /** Reading the applicant's mail for the code or link a site sent. */
  verifying: "verifying",
  /** Signing in to, or creating, the site's account. */
  account: "account",
  diagnosing: "diagnosing",
} as const;

export type RunStage = (typeof RUN_STAGE)[keyof typeof RUN_STAGE];

/** How a run ended. */
export const RUN_OUTCOME = {
  completed: "completed",
  failed: "failed",
  /** The person pressed Stop. */
  stopped: "stopped",
  /** Stop before Submit: every step is filled and the run stopped at the control that sends it. */
  readyToSubmit: "ready_to_submit",
} as const;

export type RunOutcome = (typeof RUN_OUTCOME)[keyof typeof RUN_OUTCOME];

/** Reasons the run names itself, without asking the decision model. */
export const RUN_FAILURE_REASON = {
  /** No résumé was chosen for the job (no description found, or no Library résumé fits). */
  resumeNotChosen: "resume_not_chosen",
  /** The run reached its cap on fills of one step or on model calls. */
  budgetSpent: "ai_budget_spent",
  /** A step only the applicant can do (a code sent to them) was not done in time. */
  waitedForPerson: "waited_for_person",
  /** The emailed code or link was not in the site's best emails, or never arrived. */
  verificationNotFound: "verification_not_found",
  /** Every look at the connected Gmail failed (the mailbox or Google did not answer). */
  mailUnreadable: "mail_unreadable",
  /** The site kept rejecting the sign-in, sign-up, or password reset. */
  accountRejected: "account_rejected",
  /** The site needs an account and the profile has no default account password. */
  noAccountPassword: "no_account_password",
  /** The person pressed Stop. */
  stoppedByUser: "stopped_by_user",
  /** Round after round, the page kept needing the same things: the run went in circles. */
  noProgress: "no_progress",
  /** What a requirement's click opened (an entry form) was refused each time it was saved. */
  scopeRefused: "scope_refused",
  /** The tab the application was in closed, and it opened no other to go on in. */
  tabClosed: "tab_closed",
  /** A required field's question is not on the page, so the run cannot answer it and does not send the form. */
  needsAnswer: "needs_answer",
  /** No content script of Acorn answered in the page, though it was injected again: the page is unreadable to the run. */
  pageUnreachable: "page_unreachable",
  /** The page is filled but no control on it could be found that moves the application forward. */
  noForwardControl: "no_forward_control",
  /** The AI could not answer (no key, no credits, rate limit, provider down): see RunFailure.code. */
  aiUnavailable: "ai_unavailable",
  /** The page shows there is no online application to make for this job (agentStop.kind says how). */
  jobUnavailable: "job_unavailable",
} as const;

/** Why a run could not finish, in the decision model's words (mirrors the backend's reasons). */
export interface RunFailure {
  reason: string;
  /** The backend's stable error code, when the failure came from a refused call (user-messages.ts). */
  code?: string;
  label: string;
  /** The page's own words behind the reason: flagged fields, alerts, failed steps. */
  detail: string;
  stage: RunStage;
  /**
   * Set when the agent ended the run itself: why (an AGENT_STOP_REASON), what the page
   * needs or what went wrong, and what the person should do. The sidebar shows it as a
   * "needs you" or "couldn't finish" notice. `kind` comes with `job_unavailable` only.
   */
  agentStop?: { reason: string; kind?: string; problem: string; action: string };
}

export interface RunReport {
  outcome: RunOutcome;
  /** Pages the run moved through, counting the first. */
  pages: number;
  /** Refill rounds spent across the whole run. */
  refills: number;
  failure?: RunFailure;
  /** Decision-model cost of the Run's own decisions (page reads and diagnosis). */
  usage?: AiUsageSummary | null;
}

/** Live Run state shown in the sidebar. */
/** Verification kinds the run can answer from the applicant's connected Gmail. */
export const VERIFICATION = {
  emailCode: "email_code",
  emailLink: "email_link",
} as const;

export type VerificationKind = (typeof VERIFICATION)[keyof typeof VERIFICATION];

/** Outcomes of one look in Gmail for a verification code or link. */
export const MAIL_VERIFICATION_STATUS = {
  found: "found",
  pending: "pending",
  notFound: "not_found",
  /** No Gmail mailbox is connected for this account. */
  noMailbox: "no_mailbox",
} as const;

export type MailVerificationStatus =
  (typeof MAIL_VERIFICATION_STATUS)[keyof typeof MAIL_VERIFICATION_STATUS];

/** One email read while looking for a code or link, and how likely it is the one the site sent. */
export interface MailSearchEmail {
  id: string;
  /** Sender, as the email shows it. */
  from: string;
  subject: string;
  /** When it arrived (ms since epoch); 0 when unknown. */
  receivedAt: number;
  /** It arrived after the site was asked to send (or that time is not known), so it may compete. */
  after: boolean;
  /** The decision model weighed it; one from before the request is not weighed. */
  judged: boolean;
  /** The chance (0 to 1) the decision model gave that the site sent it for this step. */
  probability: number;
}

/** Where a look in Gmail for a code or link stands. */
export const MAIL_SEARCH_STATE = {
  searching: "searching",
  found: "found",
  /** The search ended without a code or link. */
  missed: "missed",
} as const;

export type MailSearchState = (typeof MAIL_SEARCH_STATE)[keyof typeof MAIL_SEARCH_STATE];

/** What an agent Run is reading in Gmail for a code or link, shown on the Now card. */
export interface MailSearch {
  kind: VerificationKind;
  state: MailSearchState;
  /** Only mail that arrived after this (ms since epoch) can be the site's. */
  since: number;
  /** How many times Gmail has been looked at. */
  looks: number;
  /** The newest emails the last look read, newest first. */
  emails: MailSearchEmail[];
  /** The email the code or link was taken from, once found. */
  chosenId?: string;
  /** What was taken from it, for the person to read: the code, or the link's address without its query. */
  shown?: string;
  /** Why the search ended without one. */
  detail?: string;
}

/** What an agent Run is doing, as the sidebar's map of the page says it. */
export const RUN_MAP_PHASE = {
  /** The tab is open; the first look has not been taken. */
  starting: "starting",
  /** A screenshot, or a survey of the whole page, is being taken. */
  looking: "looking",
  /** The look is with the model. */
  thinking: "thinking",
  /** The plan is being carried out. */
  acting: "acting",
  /** The run waits on the person: a question, a code, a CAPTCHA. */
  waiting: "waiting",
  ended: "ended",
} as const;
export type RunMapPhase = (typeof RUN_MAP_PHASE)[keyof typeof RUN_MAP_PHASE];

/** What became of one point of the plan being carried out. */
export const RUN_POINT_STATE = {
  pending: "pending",
  /** The one being acted on now. */
  current: "current",
  done: "done",
  failed: "failed",
  /** Not run: an action before it failed. */
  skipped: "skipped",
} as const;
export type RunPointState = (typeof RUN_POINT_STATE)[keyof typeof RUN_POINT_STATE];

/**
 * A control of the page as the page reports it (an input, a dropdown, a button, a check, a file field), CSS
 * pixels from the page's top left, and what the page says of it. `id` is the page's own name for the control,
 * the same while it stays. Radio buttons, and check boxes that share a name, answer one question: they share
 * `group`, and `question` is what the page calls that question. `value` is what the control shows now (a
 * typed answer, a chosen option, a file's name) for the person to read in the sidebar: never a password or
 * a secret the run typed, and left out of the progress relayed to acorn-backend.
 */
export interface RunMapControl {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  group?: string;
  question?: string;
  required?: boolean;
  /** A text box, a text area or a native list says whether it is empty; left out when the page cannot tell. */
  empty?: boolean;
  /** A check or a radio button says whether it is ticked. */
  checked?: boolean;
  invalid?: boolean;
  value?: string;
}

/** One question of the form as the model read it: its label, where it is (CSS pixels) and its state. */
export interface RunMapField {
  label: string;
  y: number;
  state: "filled" | "empty" | "needs_person";
}

/** A point of the plan: where it aims on the page (CSS pixels) and what became of it. */
export interface RunMapPoint {
  id: string;
  kind: string;
  x: number;
  y: number;
  state: RunPointState;
  /** The point was acted on somewhere else than it was planned: it followed its control, or was found again by its picture. */
  moved?: boolean;
  /** The control the point acts on, by its id: the one the plan bound it to, else the one it lands on. */
  control?: string;
}

/** A screen of the last survey (CSS pixels): photographed for it, or reused from an earlier look. */
export interface RunMapScreen {
  top: number;
  height: number;
  reused: boolean;
}

/** A move of the form since the agent last saw the page (CSS pixels): what lay between `from` and `at` appeared or went, and what lies below moved by `dy`. */
export interface RunMapMove {
  from: number;
  at: number;
  dy: number;
}

/**
 * The page an agent Run is on, for the sidebar's map of it: how large it is, where the window is, the
 * parts the model settled (will not come back to), the page's controls, the points of the plan and what
 * became of each, the screens of the last survey and where the form moved; all in CSS pixels from the top
 * left of the page. A run has one from the moment it has a page, and keeps it when it ends.
 */
export interface RunMap {
  phase: RunMapPhase;
  pageWidth: number;
  pageHeight: number;
  viewTop: number;
  viewHeight: number;
  settled: { from: number; to: number }[];
  /** How far down the page the plan being carried out first acts: nothing above it changes. Unset until a plan. */
  fence?: number;
  /** The band round the control that sends the page or goes on, painted red. Unset until the model named one. */
  key?: { from: number; to: number };
  /**
   * The form's to-do list as the model read it from the pictures (CSS pixels): the questions the sidebar
   * lists and ticks off. Unset until the model's first survey; `controls` then only says where things are.
   */
  fields?: RunMapField[];
  controls: RunMapControl[];
  points: RunMapPoint[];
  screens: RunMapScreen[];
  moves: RunMapMove[];
}

/**
 * Whether a value is a map of this build's shape: one that was made by another build (a tab's run state
 * kept in the browser outlives the code that wrote it) is not, and is shown as no map rather than read.
 */
export function isRunMap(value: unknown): value is RunMap {
  if (!value || typeof value !== "object") return false;
  const map = value as Partial<RunMap>;
  return (
    typeof map.phase === "string" &&
    [map.pageWidth, map.pageHeight, map.viewTop, map.viewHeight].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    ) &&
    [map.settled, map.controls, map.points, map.screens, map.moves].every(Array.isArray) &&
    // Controls named by the page (1.97.0): an older map's controls were boxes alone.
    (map.controls ?? []).every((control) => typeof control?.id === "string")
  );
}

export interface RunProgress {
  runId: string;
  stage: RunStage;
  /** When the run started (ms since epoch); the sidebar's run clock counts from it. */
  startedAt: number;
  /** When the run ended; set once it has, so the clock holds the final time. */
  endedAt?: number;
  /** 1-based count of pages visited. */
  page: number;
  /** An agent Run: the step it is on. One page takes many steps, so this replaces the page count in the sidebar. */
  step?: number;
  /** Refill rounds spent on the current page, and the most a page gets. */
  refills: number;
  maxRefills: number;
  /** What the run is about to click, or just clicked. */
  control?: string;
  /**
   * An agent Run: what the models have cost so far, in US dollars (OpenRouter's own figure),
   * and how many driving-model calls and screen checks that was. Unset until the first answer.
   */
  costUsd?: number;
  modelCalls?: number;
  screenChecks?: number;
  /** An agent Run: the map of the page it is on. Unset until the run has a page. */
  map?: RunMap;
  /** An agent Run waiting on the person: the question and the answers they may give. */
  ask?: { id: string; question: string; options: { id: string; label: string }[] };
  /** An agent Run reading Gmail for a code or link: the emails read, and which one was used. */
  mail?: MailSearch;
  /** The run stopped partway and the agent still remembers it: Continue takes it back up. */
  canContinue?: boolean;
  report?: RunReport;
}
