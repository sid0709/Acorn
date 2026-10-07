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

/** What kind of page the decision model says this is (mirrors the backend's page kinds). */
export const PAGE_KIND = {
  posting: "job_posting",
  form: "application_form",
  /**
   * Sign in, create an account, recover it, or go on without one. The run goes on
   * without one when it can; otherwise it signs in or creates the account.
   */
  accountStep: "account_step",
  confirmation: "confirmation",
  blocked: "blocked",
  other: "other",
} as const;

export type PageKind = (typeof PAGE_KIND)[keyof typeof PAGE_KIND];

/** What a page asks to verify (mirrors the backend's verifications). */
export const VERIFICATION = {
  none: "none",
  /** A code sent to the applicant's email: the run reads it from their connected Gmail. */
  emailCode: "email_code",
  /** A link sent to the applicant's email: the run opens it in the same tab. */
  emailLink: "email_link",
  /** Anything else only the applicant can give (a phone code, a challenge). */
  other: "other",
} as const;

export type Verification = (typeof VERIFICATION)[keyof typeof VERIFICATION];

/** What an account step asks for (mirrors the backend's account modes). */
export const ACCOUNT_MODE = {
  none: "none",
  signIn: "sign_in",
  createAccount: "create_account",
  resetPassword: "reset_password",
  choose: "choose",
} as const;

export type AccountMode = (typeof ACCOUNT_MODE)[keyof typeof ACCOUNT_MODE];

/** One account step the run sent on a site, and whether the site went on. */
export interface AccountAttempt {
  mode: AccountMode;
  accepted: boolean;
  /** The page's own words after a rejected attempt. */
  messages: string[];
}

/** How a search of the applicant's mail ended (mirrors the backend's statuses). */
export const MAIL_VERIFICATION_STATUS = {
  found: "found",
  /** No email from the site has arrived yet. */
  pending: "pending",
  /** The site's best emails hold no code or link. */
  notFound: "not_found",
  /** No Gmail is connected to read. */
  noMailbox: "no_mailbox",
} as const;

export type MailVerificationStatus =
  (typeof MAIL_VERIFICATION_STATUS)[keyof typeof MAIL_VERIFICATION_STATUS];

/** What a picked control does (mirrors the backend's roles). */
export const CONTROL_ROLE = {
  apply: "apply",
  next: "next",
  submit: "submit",
} as const;

export type ControlRole = (typeof CONTROL_ROLE)[keyof typeof CONTROL_ROLE];

/** How a run ended. */
export const RUN_OUTCOME = {
  completed: "completed",
  failed: "failed",
  /** The person pressed Stop. */
  stopped: "stopped",
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
  /** The site kept rejecting the sign-in, sign-up, or password reset. */
  accountRejected: "account_rejected",
  /** The site needs an account and the profile has no default account password. */
  noAccountPassword: "no_account_password",
  /** The person pressed Stop. */
  stoppedByUser: "stopped_by_user",
} as const;

/** Why a run could not finish, in the decision model's words (mirrors the backend's reasons). */
export interface RunFailure {
  reason: string;
  label: string;
  /** The page's own words behind the reason: flagged fields, alerts, failed steps. */
  detail: string;
  stage: RunStage;
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
export interface RunProgress {
  runId: string;
  stage: RunStage;
  /** When the run started (ms since epoch); the sidebar's run clock counts from it. */
  startedAt: number;
  /** When the run ended; set once it has, so the clock holds the final time. */
  endedAt?: number;
  /** 1-based count of pages visited. */
  page: number;
  /** Refill rounds spent on the current page, and the most a page gets. */
  refills: number;
  maxRefills: number;
  /** The kind the decision model gave the current page. */
  kind?: PageKind;
  /** What the run is about to click, or just clicked. */
  control?: string;
  report?: RunReport;
}
