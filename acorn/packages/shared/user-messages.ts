/**
 * What the person is told about a run and about anything that goes wrong: one catalogue, from every way a
 * run can end, every stop the agent makes, every failure the run names, the agent server's and acorn-backend's
 * error codes, and the extension's own errors, to a title, what it means and what to do, a tone and an icon,
 * and the buttons that do it. The sidebar's notification cards and the Now card both read it, so they always
 * say the same thing. Raw error text is never the title or the description: it stays in `technical`, the
 * card's details and the Logs tab.
 */

import { AGENT_ERROR_CODE, AGENT_STOP_REASON, AGENT_UNAVAILABLE_KIND } from "./agent-contract";
import { RUN_FAILURE_REASON, RUN_OUTCOME, type RunFailure, type RunReport } from "./run-types";

/** The codes acorn-backend sends beside an error (acornapi/errcode.go). */
export const ERROR_CODE = {
  signedOut: "signed_out",
  killSwitch: "kill_switch",
  noKey: "openrouter_no_key",
  invalidKey: "openrouter_invalid_key",
  noCredits: "openrouter_no_credits",
  rateLimited: "openrouter_rate_limited",
  providerDown: "provider_error",
  modelTimeout: "model_timeout",
  modelBadAnswer: "model_bad_answer",
  modelUnavailable: "model_unavailable",
} as const;

/** Codes the extension raises itself, for failures that never reached a server or that a server cannot name. */
export const LOCAL_ERROR_CODE = {
  offline: "offline",
  timeout: "timeout",
  serverOld: "server_old",
  outOfSync: "out_of_sync",
  pageChanged: "page_changed",
  pageBusy: "page_busy",
  stopped: "stopped",
  noResume: "no_resume",
  /** The agent server no longer holds the run (it expired or restarted). */
  runEnded: "run_ended",
  /** The agent server could not reach acorn-backend for the person's profile. */
  backendUnreachable: "backend_unreachable",
  noProfile: "no_profile",
  badFallbackResume: "bad_fallback_resume",
  /** The browser took the tab away from Acorn's control (not by the person's Cancel, which is a pause). */
  debuggerLost: "debugger_lost",
  /** A browser or extension page, where no extension may work. */
  pageForbidden: "page_forbidden",
  tabGone: "tab_gone",
  unknown: "unknown",
} as const;

/** How a run ended, as the catalogue names it. */
export const END_CODE = {
  sent: "sent",
  alreadyApplied: "already_applied",
  readyToSubmit: "ready_to_submit",
  paused: "paused",
} as const;

/** What a notice's buttons do; the sidebar runs them on the tab the notice is about. */
export const NOTICE_ACTION = {
  continue: "continue",
  runAgain: "run-again",
  jobQueue: "job-queue",
  showOnPage: "show-on-page",
  openProfile: "open-profile",
  openLibrary: "open-library",
  reconnectGmail: "reconnect-gmail",
  addCredits: "add-credits",
  report: "report",
} as const;
export type NoticeAction = (typeof NOTICE_ACTION)[keyof typeof NOTICE_ACTION];

/** A button's words. */
export const NOTICE_ACTION_LABEL: Record<NoticeAction, string> = {
  [NOTICE_ACTION.continue]: "Continue",
  [NOTICE_ACTION.runAgain]: "Run again",
  [NOTICE_ACTION.jobQueue]: "Job queue",
  [NOTICE_ACTION.showOnPage]: "Show me",
  [NOTICE_ACTION.openProfile]: "Open profile",
  [NOTICE_ACTION.openLibrary]: "Open Library",
  [NOTICE_ACTION.reconnectGmail]: "Reconnect Gmail",
  [NOTICE_ACTION.addCredits]: "Add credits",
  [NOTICE_ACTION.report]: "Report",
};

/** The design system's notification tones. */
export type NoticeTone = "success" | "accent" | "warning" | "danger" | "neutral";

/** The icon a message is drawn with: a design-system glyph name. */
export type MessageGlyph =
  | "check"
  | "info"
  | "alert"
  | "alertCircle"
  | "lock"
  | "mail"
  | "creditCard"
  | "upload"
  | "user"
  | "refresh"
  | "clock"
  | "file"
  | "eye"
  | "pause"
  | "close"
  | "search"
  | "settings";

export type UserMessage = {
  /** A few words: what happened. */
  title: string;
  /** One or two sentences: what it means and what to do. */
  detail: string;
  tone: NoticeTone;
  glyph: MessageGlyph;
  /** Up to two buttons, the first the main one. */
  actions: NoticeAction[];
  /** Stays on screen until it is acted on or the run moves on: the person must do something. */
  sticky: boolean;
};

const A = NOTICE_ACTION;

/** Builds a message; `actions` and `sticky` are the common case left out. */
function msg(
  tone: NoticeTone,
  glyph: MessageGlyph,
  title: string,
  detail: string,
  actions: NoticeAction[] = [],
  sticky = tone === "warning" || tone === "danger",
): UserMessage {
  return { title, detail, tone, glyph, actions, sticky };
}

/** The key of a stop the agent made, of a job that cannot be applied to by its kind, and of a failure reason. */
const stopKey = (reason: string) => `stop:${reason}`;
const unavailableKey = (kind: string) => `unavailable:${kind}`;
const failureKey = (reason: string) => `failure:${reason}`;
/** The agent's "other" stop when the run could not go on, as opposed to when it needs the person. */
const STOP_OTHER_STUCK = "stop:other:stuck";
const UNAVAILABLE_FALLBACK = "unavailable:";

const MESSAGES: Record<string, UserMessage> = {
  // How a run ended.
  [END_CODE.sent]: msg(
    "success",
    "check",
    "Application sent",
    "The employer confirmed they received it.",
    [A.jobQueue],
  ),
  [END_CODE.alreadyApplied]: msg(
    "success",
    "check",
    "Already applied",
    "The employer already has your application for this job, so there was nothing to send again.",
    [A.jobQueue],
  ),
  [END_CODE.readyToSubmit]: msg(
    "accent",
    "eye",
    "Ready for you to submit",
    "Every field is filled. Check the page, then press Submit yourself: Acorn did not send it.",
    [A.showOnPage],
    true,
  ),
  [END_CODE.paused]: msg(
    "neutral",
    "pause",
    "Run paused",
    "Acorn stopped where it was. Continue picks it up from there.",
    [A.continue],
  ),

  // The agent stopped for the person.
  [stopKey(AGENT_STOP_REASON.captcha)]: msg(
    "warning",
    "lock",
    "Prove you're human",
    "The site wants a person to solve a check. Solve it on the page, then press Continue.",
    [A.continue],
  ),
  [stopKey(AGENT_STOP_REASON.verification)]: msg(
    "warning",
    "mail",
    "Enter the code from your email",
    "The site emailed you a code. Type it on the page, then press Continue.",
    [A.continue],
  ),
  [stopKey(AGENT_STOP_REASON.verificationLink)]: msg(
    "warning",
    "mail",
    "Confirm your email",
    "Open the link the site emailed you, then come back and press Continue.",
    [A.continue],
  ),
  [stopKey(AGENT_STOP_REASON.identity)]: msg(
    "warning",
    "creditCard",
    "Only you can enter this",
    "The form asks for something only you should give, like an ID number. Enter it, then press Continue.",
    [A.continue],
  ),
  [stopKey(AGENT_STOP_REASON.document)]: msg(
    "warning",
    "upload",
    "A document is needed",
    "The form asks for a file Acorn doesn't have. Attach it, then press Continue.",
    [A.continue],
  ),
  [stopKey(AGENT_STOP_REASON.signIn)]: msg(
    "warning",
    "user",
    "Sign in to the site",
    "The site needs you signed in. Sign in on the page, then press Continue.",
    [A.continue],
  ),
  [stopKey(AGENT_STOP_REASON.accountRejected)]: msg(
    "warning",
    "user",
    "The site won't accept the account",
    "Signing in, signing up and resetting the password all failed. Sign in yourself, then press Continue.",
    [A.continue],
  ),
  [stopKey(AGENT_STOP_REASON.other)]: msg(
    "warning",
    "user",
    "Acorn needs you here",
    "Do what the page asks, then press Continue.",
    [A.continue],
  ),
  [stopKey(AGENT_STOP_REASON.resumeChoice)]: msg(
    "accent",
    "file",
    "Choose your résumé",
    "No job description was found, so pick the résumé to send.",
    [],
    true,
  ),

  // The agent could not go on.
  [stopKey(AGENT_STOP_REASON.pageProblem)]: msg(
    "warning",
    "alert",
    "The page has a problem",
    "Something on the page is stopping Acorn. Fix it, then press Continue.",
    [A.continue, A.report],
  ),
  [STOP_OTHER_STUCK]: msg(
    "warning",
    "alert",
    "Acorn couldn't finish this page",
    "Look at what the page needs, then press Continue.",
    [A.continue, A.report],
  ),
  [stopKey(AGENT_STOP_REASON.noChange)]: msg(
    "warning",
    "refresh",
    "The page stopped responding",
    "Acorn's clicks and typing changed nothing. Check for something in the way, then press Continue.",
    [A.continue],
  ),
  [stopKey(AGENT_STOP_REASON.stepLimit)]: msg(
    "warning",
    "clock",
    "A long application",
    "Acorn used all its steps for this run. Continue gives it more.",
    [A.continue],
  ),
  [stopKey(AGENT_STOP_REASON.notConfirmed)]: msg(
    "warning",
    "alertCircle",
    "Couldn't confirm it was sent",
    "The page never showed a confirmation. Check whether it went through; if the form is still open, press Continue.",
    [A.continue, A.runAgain],
  ),

  // A job nobody can apply to here.
  [unavailableKey(AGENT_UNAVAILABLE_KIND.expired)]: msg(
    "neutral",
    "info",
    "This job is closed",
    "The employer isn't taking applications for it any more.",
    [A.jobQueue],
  ),
  [unavailableKey(AGENT_UNAVAILABLE_KIND.noOnlineApply)]: msg(
    "neutral",
    "info",
    "Apply by email or phone",
    "This employer doesn't take applications on this page.",
    [A.jobQueue],
  ),
  [unavailableKey(AGENT_UNAVAILABLE_KIND.notAJob)]: msg(
    "neutral",
    "info",
    "Not a job posting",
    "This page isn't a job application.",
    [A.jobQueue],
  ),
  [UNAVAILABLE_FALLBACK]: msg(
    "neutral",
    "info",
    "This job can't be applied to online",
    "There is nothing to fill here.",
    [A.jobQueue],
  ),

  // Failures the run names itself.
  [failureKey(RUN_FAILURE_REASON.resumeNotChosen)]: msg(
    "warning",
    "file",
    "No résumé chosen",
    "Add or pick a résumé for this job, then run again.",
    [A.openLibrary, A.runAgain],
  ),
  [failureKey(RUN_FAILURE_REASON.budgetSpent)]: msg(
    "warning",
    "clock",
    "This run hit its AI budget",
    "Run again, or finish the last steps yourself.",
    [A.runAgain],
  ),
  [failureKey(RUN_FAILURE_REASON.waitedForPerson)]: msg(
    "warning",
    "user",
    "Acorn needs you here",
    "Finish that step on the page, then press Continue.",
    [A.continue],
  ),
  [failureKey(RUN_FAILURE_REASON.verificationNotFound)]: msg(
    "warning",
    "mail",
    "Code not found in Gmail",
    "Acorn couldn't find the site's email. Check your inbox, enter the code on the page, then press Continue.",
    [A.continue],
  ),
  [failureKey(RUN_FAILURE_REASON.mailUnreadable)]: msg(
    "danger",
    "mail",
    "Reconnect Gmail",
    "Acorn can't read your inbox for the site's code. Reconnect Gmail, then run again.",
    [A.reconnectGmail],
  ),
  [failureKey(RUN_FAILURE_REASON.accountRejected)]: msg(
    "warning",
    "user",
    "The site won't accept the account",
    "Check the account on the site, sign in yourself, then press Continue.",
    [A.continue],
  ),
  [failureKey(RUN_FAILURE_REASON.noAccountPassword)]: msg(
    "warning",
    "lock",
    "Add an account password",
    "The site needs an account. Add a default account password in your profile, then run again.",
    [A.openProfile],
  ),
  [failureKey(RUN_FAILURE_REASON.noProgress)]: msg(
    "warning",
    "alert",
    "Acorn couldn't finish this page",
    "Look at what the page is asking for, fix it, then press Continue.",
    [A.continue, A.report],
  ),
  [failureKey(RUN_FAILURE_REASON.scopeRefused)]: msg(
    "warning",
    "user",
    "This part is yours to fill",
    "Fill that section yourself, then press Continue.",
    [A.continue],
  ),
  [failureKey(RUN_FAILURE_REASON.tabClosed)]: msg(
    "neutral",
    "close",
    "The tab was closed",
    "Open the job again to run once more.",
  ),
  [failureKey(RUN_FAILURE_REASON.needsAnswer)]: msg(
    "warning",
    "user",
    "The page needs your answer",
    "Answer it on the page yourself, then press Continue.",
    [A.continue],
  ),
  [failureKey(RUN_FAILURE_REASON.pageUnreachable)]: msg(
    "warning",
    "refresh",
    "The page didn't load",
    "Reload the page, then press Continue.",
    [A.continue],
  ),
  [failureKey(RUN_FAILURE_REASON.noForwardControl)]: msg(
    "warning",
    "search",
    "Can't find how to go on",
    "Click the button that moves the application forward, then press Continue.",
    [A.continue],
  ),

  // acorn-backend's codes.
  [ERROR_CODE.signedOut]: msg(
    "danger",
    "user",
    "You're signed out",
    "Sign in to Acorn to run applications.",
  ),
  [ERROR_CODE.killSwitch]: msg(
    "warning",
    "clock",
    "Acorn AI is paused",
    "It's temporarily unavailable. Try again in a little while.",
    [A.continue],
  ),
  [ERROR_CODE.noKey]: msg(
    "danger",
    "lock",
    "Add your OpenRouter key",
    "Acorn needs your OpenRouter API key to read pages and fill forms. Add it in your profile, then press Continue.",
    [A.openProfile, A.continue],
  ),
  [ERROR_CODE.invalidKey]: msg(
    "danger",
    "lock",
    "OpenRouter rejected your key",
    "Check that the key in your profile is correct and still active, then press Continue.",
    [A.openProfile, A.continue],
  ),
  [ERROR_CODE.noCredits]: msg(
    "danger",
    "creditCard",
    "Your OpenRouter balance is empty",
    "Add credits at OpenRouter, then press Continue: Acorn picks up where it stopped.",
    [A.addCredits, A.continue],
  ),
  [ERROR_CODE.rateLimited]: msg(
    "warning",
    "clock",
    "OpenRouter is busy",
    "Too many requests went out in a short time. Wait a minute, then press Continue.",
    [A.continue],
  ),
  [ERROR_CODE.providerDown]: msg(
    "warning",
    "alert",
    "The AI service isn't answering",
    "OpenRouter or the model is having trouble. Try again in a moment.",
    [A.continue],
  ),
  [ERROR_CODE.modelTimeout]: msg(
    "warning",
    "clock",
    "The AI took too long",
    "This is usually temporary. Press Continue to try again.",
    [A.continue],
  ),
  [ERROR_CODE.modelBadAnswer]: msg(
    "warning",
    "alert",
    "The AI's answer couldn't be used",
    "This is usually temporary. Press Continue, and report it if it keeps happening.",
    [A.continue, A.report],
  ),
  [ERROR_CODE.modelUnavailable]: msg(
    "danger",
    "settings",
    "Acorn's AI isn't set up",
    "The server has no model configured. Report it so support can fix it.",
    [A.report],
  ),

  // The extension's own.
  [LOCAL_ERROR_CODE.offline]: msg(
    "danger",
    "refresh",
    "Can't reach Acorn",
    "Check your internet connection, then press Continue.",
    [A.continue],
  ),
  [LOCAL_ERROR_CODE.timeout]: msg(
    "warning",
    "clock",
    "Acorn took too long to answer",
    "Try again in a moment.",
    [A.continue],
  ),
  [LOCAL_ERROR_CODE.serverOld]: msg(
    "danger",
    "settings",
    "The Acorn server needs an update",
    "This extension uses something the server doesn't have yet.",
    [A.report],
  ),
  [LOCAL_ERROR_CODE.outOfSync]: msg(
    "danger",
    "settings",
    "Acorn needs an update",
    "The extension and the server don't match. Update the Acorn extension, then run again.",
    [A.report],
  ),
  [LOCAL_ERROR_CODE.pageChanged]: msg(
    "accent",
    "refresh",
    "The page changed",
    "Acorn reads it again and carries on.",
  ),
  [LOCAL_ERROR_CODE.pageBusy]: msg(
    "accent",
    "clock",
    "The page isn't ready yet",
    "A button stays disabled until the page has what it needs. Acorn fills it and tries again.",
  ),
  [LOCAL_ERROR_CODE.noResume]: msg(
    "danger",
    "file",
    "Add a résumé",
    "Your Library has no résumé to send. Add one, then run again.",
    [A.openLibrary],
  ),
  [LOCAL_ERROR_CODE.runEnded]: msg(
    "warning",
    "refresh",
    "This run ended",
    "The server no longer holds it: it expired or restarted. Press Run again to start fresh.",
    [A.runAgain],
  ),
  [LOCAL_ERROR_CODE.backendUnreachable]: msg(
    "danger",
    "refresh",
    "Acorn can't load your profile",
    "The server couldn't reach your Acorn account. Try again in a moment.",
    [A.continue],
  ),
  [LOCAL_ERROR_CODE.noProfile]: msg(
    "danger",
    "user",
    "Finish your profile",
    "Acorn needs your details to fill forms. Complete your profile, then run again.",
    [A.openProfile],
  ),
  [LOCAL_ERROR_CODE.badFallbackResume]: msg(
    "danger",
    "file",
    "That résumé isn't in your Library",
    "Pick another résumé in your Library, then run again.",
    [A.openLibrary],
  ),
  [LOCAL_ERROR_CODE.debuggerLost]: msg(
    "danger",
    "alertCircle",
    "Acorn lost control of the tab",
    "The browser stopped letting Acorn click and type here. Press Run again.",
    [A.runAgain],
  ),
  [LOCAL_ERROR_CODE.pageForbidden]: msg(
    "neutral",
    "info",
    "Acorn can't work on this page",
    "Browser and extension pages don't allow it. Open a job page and run there.",
  ),
  [LOCAL_ERROR_CODE.tabGone]: msg(
    "neutral",
    "close",
    "The tab was closed",
    "Open the job again to run once more.",
  ),
  [LOCAL_ERROR_CODE.unknown]: msg(
    "danger",
    "alertCircle",
    "Acorn hit a snag",
    "Something unexpected stopped the run. Press Continue to try again, and report it if it repeats.",
    [A.continue, A.report],
  ),
};
MESSAGES[LOCAL_ERROR_CODE.stopped] = MESSAGES[END_CODE.paused];
MESSAGES[failureKey(RUN_FAILURE_REASON.stoppedByUser)] = MESSAGES[END_CODE.paused];
MESSAGES[failureKey(RUN_FAILURE_REASON.jobUnavailable)] = MESSAGES[UNAVAILABLE_FALLBACK];

/** The message for a code; the snag message for one the catalogue does not know. */
export function messageFor(code: string): UserMessage {
  return MESSAGES[code] ?? MESSAGES[LOCAL_ERROR_CODE.unknown];
}

/** Whether the catalogue has words for this code. */
export function knowsErrorCode(code: string | null | undefined): code is string {
  return Boolean(code && MESSAGES[code]);
}

/** The catalogue's code for each error code the agent server sends (acorn-agent httpapi `writeError`). */
const AGENT_CODE: Record<string, string> = {
  [AGENT_ERROR_CODE.noKey]: ERROR_CODE.noKey,
  [AGENT_ERROR_CODE.invalidKey]: ERROR_CODE.invalidKey,
  [AGENT_ERROR_CODE.noCredits]: ERROR_CODE.noCredits,
  [AGENT_ERROR_CODE.rateLimited]: ERROR_CODE.rateLimited,
  [AGENT_ERROR_CODE.badRequest]: LOCAL_ERROR_CODE.unknown,
  [AGENT_ERROR_CODE.modelError]: ERROR_CODE.providerDown,
  [AGENT_ERROR_CODE.network]: ERROR_CODE.providerDown,
  [AGENT_ERROR_CODE.cancelled]: LOCAL_ERROR_CODE.timeout,
  [AGENT_ERROR_CODE.noSession]: LOCAL_ERROR_CODE.runEnded,
  [AGENT_ERROR_CODE.runOver]: LOCAL_ERROR_CODE.runEnded,
  [AGENT_ERROR_CODE.badObservation]: LOCAL_ERROR_CODE.unknown,
  [AGENT_ERROR_CODE.noProfile]: LOCAL_ERROR_CODE.noProfile,
  [AGENT_ERROR_CODE.noResume]: LOCAL_ERROR_CODE.noResume,
  [AGENT_ERROR_CODE.badJson]: LOCAL_ERROR_CODE.unknown,
  [AGENT_ERROR_CODE.signedOut]: ERROR_CODE.signedOut,
  [AGENT_ERROR_CODE.backendUnreachable]: LOCAL_ERROR_CODE.backendUnreachable,
  [AGENT_ERROR_CODE.badFallbackResume]: LOCAL_ERROR_CODE.badFallbackResume,
  [AGENT_ERROR_CODE.missingBlobs]: LOCAL_ERROR_CODE.unknown,
  // The client's own names for a request that never got an answer.
  unreachable: LOCAL_ERROR_CODE.offline,
  timeout: LOCAL_ERROR_CODE.timeout,
};

/** The catalogue's code for an agent server error code, or null for one it does not send. */
export function codeForAgentError(code: string | null | undefined): string | null {
  return (code && AGENT_CODE[code]) || null;
}

/** What a bare HTTP status means when the server gave no code. */
function codeForStatus(status: number): string | null {
  if (status === 401) return ERROR_CODE.signedOut;
  if (status === 402) return ERROR_CODE.noCredits;
  if (status === 429) return ERROR_CODE.rateLimited;
  if (status === 408 || status === 504) return LOCAL_ERROR_CODE.timeout;
  if (status === 502 || status === 503) return ERROR_CODE.providerDown;
  if (status === 400 || status === 404 || status === 413 || status === 422) {
    return LOCAL_ERROR_CODE.outOfSync;
  }
  return null;
}

/** Patterns in error text the extension or the browser raised, first match wins. */
const TEXT_RULES: ReadonlyArray<[RegExp, string]> = [
  [/sign in to acorn required|sign in required|session expired/i, ERROR_CODE.signedOut],
  [
    /failed to fetch|networkerror|load failed|could not reach the acorn server|can't reach acorn/i,
    LOCAL_ERROR_CODE.offline,
  ],
  [/plan run aborted|^aborted/i, LOCAL_ERROR_CODE.stopped],
  [/add your openrouter api key/i, ERROR_CODE.noKey],
  [
    /doesn't support refill|refill_unsupported|needs .* on this acorn api/i,
    LOCAL_ERROR_CODE.serverOld,
  ],
  [/no résumé file|no resume file|resume was not chosen/i, LOCAL_ERROR_CODE.noResume],
  [/control is disabled/i, LOCAL_ERROR_CODE.pageBusy],
  [
    /cannot access a chrome|chrome:\/\/|chrome-extension:\/\/|cannot be scripted|extensions gallery/i,
    LOCAL_ERROR_CODE.pageForbidden,
  ],
  [/no tab with id|tab was closed|target closed/i, LOCAL_ERROR_CODE.tabGone],
  [/debugger is not attached|another debugger is already attached/i, LOCAL_ERROR_CODE.debuggerLost],
  [
    /frame with id .* was removed|execution context was destroyed|inspected target navigated|cannot find context|detached while handling/i,
    LOCAL_ERROR_CODE.pageChanged,
  ],
  [
    /control not found|element not found|role mismatch|label mismatch|relocate found|page reloaded \d+ times/i,
    LOCAL_ERROR_CODE.pageChanged,
  ],
  [/timed out|took too long|timeouterror|aborterror/i, LOCAL_ERROR_CODE.timeout],
  [/returned no plan|non-json|invalid json|returned an empty/i, ERROR_CODE.modelBadAnswer],
];

/** The catalogue's code for raw error text, or the snag code when nothing in it is known. */
export function codeForErrorText(text: string): string {
  for (const [pattern, code] of TEXT_RULES) {
    if (pattern.test(text)) return code;
  }
  const trailing = /(?:failed:?|HTTP)\s*\(?(\d{3})\)?\s*$/i.exec(text);
  if (trailing) {
    const byStatus = codeForStatus(Number(trailing[1]));
    if (byStatus) return byStatus;
  }
  return LOCAL_ERROR_CODE.unknown;
}

export type ErrorInput = {
  /** A server's stable code, when it sent one. */
  code?: string | null;
  /** The HTTP status of the answer, when there was one. */
  status?: number | null;
  /** The raw error text, for the patterns above and for the details. */
  message?: string | null;
};

export type DescribedMessage = UserMessage & {
  /** The raw text behind it, for the details and a report; never shown as the title. */
  technical: string;
  /** Whether the catalogue knew it (the snag message otherwise). */
  known: boolean;
  /** The steps the Now card lists under "What to do", the most specific first. */
  steps: string[];
};

function described(
  message: UserMessage,
  technical: string,
  code: string,
  steps?: string[],
): DescribedMessage {
  return {
    ...message,
    technical,
    known: code !== LOCAL_ERROR_CODE.unknown,
    steps: (steps ?? [message.detail]).filter(Boolean),
  };
}

/** The message for an error: its code first, then its status, then what its text says. */
export function describeError(input: ErrorInput): DescribedMessage {
  const technical = (input.message ?? "").trim();
  const code =
    (input.code && MESSAGES[input.code] ? input.code : null) ??
    codeForAgentError(input.code) ??
    (input.status ? codeForStatus(input.status) : null) ??
    codeForErrorText(technical);
  return described(messageFor(code), technical, code);
}

/** The key of a stop the agent made: its reason, its kind for a job that cannot be applied to, and for
 * "other" whether the person was needed or the run could not go on. */
function stopCode(failure: RunFailure): string {
  const stop = failure.agentStop!;
  if (
    failure.reason === RUN_FAILURE_REASON.jobUnavailable ||
    stop.reason === AGENT_STOP_REASON.jobUnavailable
  ) {
    return MESSAGES[unavailableKey(stop.kind ?? "")]
      ? unavailableKey(stop.kind ?? "")
      : UNAVAILABLE_FALLBACK;
  }
  if (
    stop.reason === AGENT_STOP_REASON.other &&
    failure.reason !== RUN_FAILURE_REASON.waitedForPerson
  ) {
    return STOP_OTHER_STUCK;
  }
  if (MESSAGES[stopKey(stop.reason)]) return stopKey(stop.reason);
  return failure.reason === RUN_FAILURE_REASON.waitedForPerson
    ? stopKey(AGENT_STOP_REASON.other)
    : STOP_OTHER_STUCK;
}

/**
 * A run's failure for the person. A stop the agent made keeps its catalogue title, with the page's own
 * problem in the model's plain words as the description and its suggested action as the first step; a
 * failure with a code or a reason takes the catalogue's words; anything else is read from its text.
 */
export function describeRunFailure(failure: RunFailure): DescribedMessage {
  const technical = [failure.label, failure.detail].filter(Boolean).join(": ");
  if (failure.code && MESSAGES[failure.code]) {
    return described(MESSAGES[failure.code], technical, failure.code);
  }
  const stop = failure.agentStop;
  if (stop) {
    const code = stopCode(failure);
    const base = MESSAGES[code];
    const problem = stop.problem.trim();
    return described({ ...base, detail: problem || base.detail }, technical, code, [
      stop.action.trim(),
      base.detail,
    ]);
  }
  if (failure.reason === RUN_FAILURE_REASON.aiUnavailable) {
    return described(MESSAGES[ERROR_CODE.providerDown], technical, ERROR_CODE.providerDown);
  }
  const byReason = failureKey(failure.reason);
  if (MESSAGES[byReason] && failure.reason !== RUN_FAILURE_REASON.noProgress) {
    return described(MESSAGES[byReason], technical, byReason);
  }
  // No progress, or a reason the catalogue does not know: what the error text says, else its reason's words.
  const byText = codeForErrorText(technical);
  if (byText !== LOCAL_ERROR_CODE.unknown) return described(MESSAGES[byText], technical, byText);
  const code = MESSAGES[byReason] ? byReason : LOCAL_ERROR_CODE.unknown;
  return described(MESSAGES[code], technical, code);
}

/** How a run ended, for the person: sent, already applied, ready to submit, paused, or why it failed. */
export function describeRunEnd(report: RunReport): DescribedMessage {
  switch (report.outcome) {
    case RUN_OUTCOME.completed: {
      const code = report.alreadyApplied ? END_CODE.alreadyApplied : END_CODE.sent;
      return described(MESSAGES[code], "", code);
    }
    case RUN_OUTCOME.readyToSubmit:
      return described(MESSAGES[END_CODE.readyToSubmit], "", END_CODE.readyToSubmit);
    case RUN_OUTCOME.stopped:
      return described(MESSAGES[END_CODE.paused], "", END_CODE.paused);
  }
  if (report.failure) return describeRunFailure(report.failure);
  return described(MESSAGES[LOCAL_ERROR_CODE.unknown], "", LOCAL_ERROR_CODE.unknown);
}

/** Every code the catalogue answers for, for the test that no case is left without words. */
export const CATALOGUE_KEYS = {
  stop: stopKey,
  unavailable: unavailableKey,
  failure: failureKey,
} as const;
