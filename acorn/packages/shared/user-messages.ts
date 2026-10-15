/**
 * What the person is told when something goes wrong: one catalogue from the backend's
 * stable error codes, HTTP statuses, run-failure reasons and the extension's own error
 * text to a title, what happened, and what to do. The raw text stays in the Logs tab;
 * nothing here is for a developer.
 */

import { RUN_FAILURE_REASON, type RunFailure } from "./run-types";

/** The codes the backend sends beside an error (acornapi/errcode.go). */
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

/** Codes the extension raises itself, for failures that never reached the backend. */
export const LOCAL_ERROR_CODE = {
  offline: "offline",
  timeout: "timeout",
  serverOld: "server_old",
  outOfSync: "out_of_sync",
  pageChanged: "page_changed",
  pageBusy: "page_busy",
  stopped: "stopped",
  noResume: "no_resume",
  unknown: "unknown",
} as const;

export type UserMessageAction = "sign-in" | "open-profile" | "update" | "retry" | "report";

export type UserMessage = {
  /** A few words: what happened. */
  title: string;
  /** One or two sentences: what it means and what to do. */
  detail: string;
  action?: UserMessageAction;
  severity: "error" | "warning" | "info";
};

const MESSAGES: Record<string, UserMessage> = {
  [ERROR_CODE.signedOut]: {
    title: "You're signed out",
    detail: "Sign in to Acorn, then open this panel again and run once more.",
    action: "sign-in",
    severity: "error",
  },
  [ERROR_CODE.killSwitch]: {
    title: "Acorn AI is paused",
    detail: "Acorn AI is temporarily unavailable. Try again in a little while.",
    severity: "warning",
  },
  [ERROR_CODE.noKey]: {
    title: "Add your OpenRouter key",
    detail:
      "Acorn needs your OpenRouter API key to read pages and fill forms. Add it in your Acorn profile, then run again.",
    action: "open-profile",
    severity: "error",
  },
  [ERROR_CODE.invalidKey]: {
    title: "OpenRouter rejected your key",
    detail:
      "The OpenRouter key in your Acorn profile was refused. Check that it is correct and still active, then run again.",
    action: "open-profile",
    severity: "error",
  },
  [ERROR_CODE.noCredits]: {
    title: "Your OpenRouter balance is too low",
    detail:
      "OpenRouter has no credit left for this request. Add credits at openrouter.ai, then run again.",
    severity: "error",
  },
  [ERROR_CODE.rateLimited]: {
    title: "OpenRouter is limiting requests",
    detail: "Too many requests were sent in a short time. Wait about a minute, then run again.",
    action: "retry",
    severity: "warning",
  },
  [ERROR_CODE.providerDown]: {
    title: "The AI service isn't answering",
    detail: "OpenRouter or the model provider is having trouble right now. Try again in a moment.",
    action: "retry",
    severity: "warning",
  },
  [ERROR_CODE.modelTimeout]: {
    title: "The AI took too long",
    detail:
      "The model did not answer in time. Try again; a shorter page or a quieter moment helps.",
    action: "retry",
    severity: "warning",
  },
  [ERROR_CODE.modelBadAnswer]: {
    title: "The AI gave an answer Acorn couldn't use",
    detail: "This is usually temporary. Try again, and report it if it keeps happening.",
    action: "retry",
    severity: "warning",
  },
  [ERROR_CODE.modelUnavailable]: {
    title: "Acorn's AI isn't set up on this server",
    detail: "The server has no model configured. Contact support.",
    action: "report",
    severity: "error",
  },
  [LOCAL_ERROR_CODE.offline]: {
    title: "Can't reach Acorn",
    detail: "Check your internet connection and the API address in Settings, then try again.",
    action: "retry",
    severity: "error",
  },
  [LOCAL_ERROR_CODE.timeout]: {
    title: "Acorn took too long to answer",
    detail: "The request was stopped after waiting. Try again in a moment.",
    action: "retry",
    severity: "warning",
  },
  [LOCAL_ERROR_CODE.serverOld]: {
    title: "The Acorn server needs an update",
    detail:
      "This version of the extension uses a feature the server doesn't have yet. Update the server, then try again.",
    action: "update",
    severity: "error",
  },
  [LOCAL_ERROR_CODE.outOfSync]: {
    title: "The extension and the server are out of sync",
    detail: "Update the Acorn extension (and the server if you run your own), then try again.",
    action: "update",
    severity: "error",
  },
  [LOCAL_ERROR_CODE.pageChanged]: {
    title: "The page changed while Acorn was working",
    detail: "Acorn reads the page again and carries on. If it stops, run it once more.",
    severity: "info",
  },
  [LOCAL_ERROR_CODE.pageBusy]: {
    title: "The page isn't letting Acorn press this yet",
    detail:
      "The button is disabled, usually because the page still needs an answer. Acorn fills what is missing and tries again.",
    severity: "info",
  },
  [LOCAL_ERROR_CODE.stopped]: {
    title: "Stopped",
    detail: "The run was stopped.",
    severity: "info",
  },
  [LOCAL_ERROR_CODE.noResume]: {
    title: "No résumé to attach",
    detail: "Choose or recommend a résumé for this job first, then run again.",
    severity: "error",
  },
  [LOCAL_ERROR_CODE.unknown]: {
    title: "Something went wrong",
    detail:
      "Acorn hit an unexpected problem. The Logs tab has the details; report it if it keeps happening.",
    action: "report",
    severity: "error",
  },
};

/** Whether the catalogue has words for this code. */
export function knowsErrorCode(code: string | null | undefined): code is string {
  return Boolean(code && MESSAGES[code]);
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

/** Patterns in the extension's own error text, first match wins. */
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
    /control not found|element not found|role mismatch|label mismatch|relocate found|page reloaded \d+ times/i,
    LOCAL_ERROR_CODE.pageChanged,
  ],
  [/timed out|took too long|timeouterror|aborterror/i, LOCAL_ERROR_CODE.timeout],
  [/returned no plan|non-json|invalid json|returned an empty/i, ERROR_CODE.modelBadAnswer],
];

export type ErrorInput = {
  /** The backend's stable code, when it sent one. */
  code?: string | null;
  /** The HTTP status of the answer, when there was one. */
  status?: number | null;
  /** The raw error text, for the patterns above and for the Details. */
  message?: string | null;
};

/** The message for an error: its code first, then its status, then what its text says. */
export function describeError(
  input: ErrorInput,
): UserMessage & { technical: string; known: boolean } {
  const technical = (input.message ?? "").trim();
  const pick = (code: string): UserMessage & { technical: string; known: boolean } => ({
    ...(MESSAGES[code] ?? MESSAGES[LOCAL_ERROR_CODE.unknown]),
    technical,
    known: code !== LOCAL_ERROR_CODE.unknown,
  });
  if (input.code && MESSAGES[input.code]) return pick(input.code);
  if (input.status) {
    const byStatus = codeForStatus(input.status);
    if (byStatus) return pick(byStatus);
  }
  for (const [pattern, code] of TEXT_RULES) {
    if (pattern.test(technical)) return pick(code);
  }
  const trailing = /(?:failed:?|HTTP)\s*\(?(\d{3})\)?\s*$/i.exec(technical);
  if (trailing) {
    const byStatus = codeForStatus(Number(trailing[1]));
    if (byStatus) return pick(byStatus);
  }
  return pick(LOCAL_ERROR_CODE.unknown);
}

/** What to do next for each reason the run names itself; the label and detail say what happened. */
const FAILURE_NEXT_STEP: Record<string, string> = {
  [RUN_FAILURE_REASON.resumeNotChosen]: "Add or pick a résumé for this job, then run again.",
  [RUN_FAILURE_REASON.budgetSpent]: "Run again, or finish the remaining steps yourself.",
  [RUN_FAILURE_REASON.waitedForPerson]: "Finish that step on the page, then press Continue.",
  [RUN_FAILURE_REASON.verificationNotFound]:
    "Check your Gmail for the site's email, then press Continue.",
  [RUN_FAILURE_REASON.mailUnreadable]: "Reconnect Gmail in your Acorn profile, then run again.",
  [RUN_FAILURE_REASON.accountRejected]: "Check the account on the site, then run again.",
  [RUN_FAILURE_REASON.noAccountPassword]:
    "Add a default account password in your Acorn profile, then run again.",
  [RUN_FAILURE_REASON.alreadyApplied]: "Nothing more to do for this job.",
  [RUN_FAILURE_REASON.noProgress]:
    "Look at what the page is asking for, fix it, then press Continue.",
  [RUN_FAILURE_REASON.scopeRefused]: "Fill that section yourself, then press Continue.",
  [RUN_FAILURE_REASON.needsAnswer]: "Do it on the page yourself, then press Continue.",
  [RUN_FAILURE_REASON.tabClosed]: "Open the application again and run once more.",
};

/** A run's failure for the person: its title, what happened, and what to do. */
export function describeRunFailure(failure: RunFailure): UserMessage & { technical: string } {
  const technical = [failure.label, failure.detail].filter(Boolean).join(": ");
  if (failure.code && MESSAGES[failure.code]) {
    const base = MESSAGES[failure.code];
    return { ...base, technical };
  }
  const next = FAILURE_NEXT_STEP[failure.reason];
  const detail = [
    failure.detail && failure.detail !== failure.label ? failure.detail : "",
    next ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    title: failure.label || MESSAGES[LOCAL_ERROR_CODE.unknown].title,
    detail,
    severity: failure.reason === RUN_FAILURE_REASON.stoppedByUser ? "info" : "error",
    technical,
  };
}
