import { authHeaders, getAcornApiUrl } from "../../auth/acorn-auth";

import { loggedFetch } from "./api-log";

import type { AiUsageSummary } from "@acorn/shared/ai-usage";
import type { PageControl } from "@acorn/shared/page-controls";
import type {
  AccountAttempt,
  AccountMode,
  AccountOutcome,
  ControlRole,
  MailRow,
  MailVerificationStatus,
  PageKind,
  Verification,
} from "@acorn/shared/run-types";

export const READ_INTENT = {
  start: "start",
  advance: "advance",
} as const;

export type ReadIntent = (typeof READ_INTENT)[keyof typeof READ_INTENT];

export interface ReadPageRequest {
  runId: string;
  step: number;
  intent: ReadIntent;
  url: string;
  title: string;
  text: string;
  controls: PageControl[];
  /** The fields the page asks for, so a question worded like a challenge is seen to be a field with a box. */
  fields?: { label: string; kind: string; required: boolean; options: number }[];
  flagged: number;
  pageMessages: string[];
  /** Account steps the run already sent on this site, oldest first. */
  account: AccountAttempt[];
  /** The account step the run tries next on this site (sign in, create, or reset); sent only on account steps. */
  accountGoal?: AccountMode;
  /** Lines the page shows now that it did not at the run's last read of the same address. */
  newText?: string[];
  /** The control the run clicked last and what it does: the page's state is its answer. */
  lastClick?: { text: string; role: ControlRole; secondsAgo: number };
  /**
   * What a requirement's click opened inside the page and the run filled (an entry
   * form, a dialog): its own controls, by id, and what the page calls it. The read
   * then names the control that saves it.
   */
  scope?: { controls: number[]; title: string };
}

export interface ReadPageResponse {
  ok: boolean;
  error?: string;
  /** The backend's stable error code when the call was refused (see user-messages.ts). */
  code?: string;
  kind?: PageKind;
  kindConfidence?: number;
  /** How sure the model was of each page kind and each verification answer, for the log. */
  kindProbabilities?: Record<string, number>;
  verificationProbabilities?: Record<string, number>;
  /** The control to click; null when nothing on the page moves the application forward. */
  control?: { id: number; role: ControlRole; confidence: number } | null;
  /**
   * When `control` is null on a form being advanced: the most probable forward
   * control anyway. The run clicks it before deciding the page is stuck.
   */
  fallback?: { id: number; role: ControlRole; confidence: number } | null;
  /**
   * On a filled form: the control that does what the page still reports as
   * required (an assessment, a document, a section named as an issue). Doing it is
   * the next step, ahead of `control`.
   */
  requirement?: { id: number; role: ControlRole; confidence: number } | null;
  /**
   * With `scope` asked: the control among its own that saves or adds what the run
   * opened and filled, so the page keeps it. Null when none of them does.
   */
  commit?: { id: number; role: ControlRole; confidence: number } | null;
  /** The page offers a way to go on without signing in or creating an account. */
  guest?: boolean;
  /**
   * When `guest`: the control that goes on without an account. Asked apart from
   * `control`, which follows the account goal and may open an account form.
   */
  guestControl?: { id: number; role: ControlRole; confidence: number } | null;
  /** The page waits on something only the applicant can give (a code sent to them). */
  needsPerson?: boolean;
  /** What the page asks to verify; an email code or link is read from the applicant's Gmail. */
  verification?: Verification;
  /** What an account step asks for. */
  accountMode?: AccountMode;
  /** On an account step: whether the profile holds a default account password. */
  accountPassword?: boolean;
  /** On an account step: the account steps it offers (its own form, or a control that opens one). */
  accountOffers?: AccountMode[];
  usage?: AiUsageSummary;
}

export interface MailVerificationRequest {
  runId: string;
  step: number;
  kind: Verification;
  url: string;
  title: string;
  text: string;
  /** When the site was asked to send the email (ms since epoch); 0 reads every recent email. */
  since: number;
  /** The `seen` of the last answer: when the newest emails are the same, Jev is not asked again. */
  seen: string;
}

export interface MailVerificationResponse {
  ok: boolean;
  error?: string;
  /** The backend's stable error code when the call was refused (see user-messages.ts). */
  code?: string;
  status?: MailVerificationStatus;
  /** The code to enter, or the link to open. Set only when found. */
  value?: string;
  /** Names the newest emails this look read; sent back with the next look. */
  seen?: string;
  /** The newest emails were the same as last time; nothing was judged. */
  unchanged?: boolean;
  /** The newest emails this look read (sender and subject), with Jev's chance once judged. */
  emails?: MailRow[];
  usage?: AiUsageSummary;
}

export interface DialogRequest {
  runId: string;
  step: number;
  /** alert, confirm, prompt, or beforeunload: the browser's own dialog, not page markup. */
  kind: string;
  message: string;
  url: string;
  title: string;
  /** The control the run clicked last, which likely opened the dialog. */
  lastControl: string;
}

export interface DialogResponse {
  ok: boolean;
  error?: string;
  /** The backend's stable error code when the call was refused (see user-messages.ts). */
  code?: string;
  /** Press OK (or Leave) rather than Cancel (or Stay). */
  accept?: boolean;
  confidence?: number;
  usage?: AiUsageSummary;
}

export interface AccountOutcomeRequest {
  runId: string;
  step: number;
  /** The account step the run's click sent. */
  sent: AccountMode;
  beforeUrl: string;
  beforeTitle: string;
  url: string;
  title: string;
  text: string;
  /** Lines the page shows now that it did not before the click. */
  newText: string[];
  /** The page's own alerts and messages now. */
  pageMessages: string[];
  flagged: number;
}

export interface AccountOutcomeResponse {
  ok: boolean;
  error?: string;
  /** The backend's stable error code when the call was refused (see user-messages.ts). */
  code?: string;
  outcome?: AccountOutcome;
  confidence?: number;
  usage?: AiUsageSummary;
}

export interface DiagnoseRequest {
  runId: string;
  step: number;
  stage: string;
  attempts: number;
  url: string;
  title: string;
  text: string;
  evidence: string[];
}

export interface DiagnoseResponse {
  ok: boolean;
  error?: string;
  /** The backend's stable error code when the call was refused (see user-messages.ts). */
  code?: string;
  reason?: string;
  label?: string;
  detail?: string;
  confidence?: number;
  usage?: AiUsageSummary;
}

async function post<T extends { ok: boolean; error?: string; code?: string }>(
  path: string,
  body: unknown,
  apiUrl: string,
  tabId: number,
): Promise<T> {
  const base = (apiUrl || (await getAcornApiUrl())).replace(/\/$/, "");
  const res = await loggedFetch(
    tabId,
    `run/${path}`,
    `${base}/acorn/run/${path}`,
    {
      method: "POST",
      headers: await authHeaders(tabId),
      body: JSON.stringify(body),
    },
    // The code or link a mail look found is the one thing here that never reaches the log.
    { hide: path === "mail-verification" ? ["value"] : [] },
  );
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) {
    return { ...data, ok: false, error: data.error || data.message || `HTTP ${res.status}` };
  }
  return data;
}

/** What kind of page this is and which control to click, decided by Jev. */
export function requestReadPage(
  request: ReadPageRequest,
  apiUrl: string,
  tabId: number,
): Promise<ReadPageResponse> {
  return post<ReadPageResponse>("read-page", request, apiUrl, tabId);
}

/** How the site answered the account step the run just sent, decided by Jev. */
export function requestAccountOutcome(
  request: AccountOutcomeRequest,
  apiUrl: string,
  tabId: number,
): Promise<AccountOutcomeResponse> {
  return post<AccountOutcomeResponse>("account-outcome", request, apiUrl, tabId);
}

/** Why a run stopped, decided by Jev from what the page flagged. */
export function requestDiagnose(
  request: DiagnoseRequest,
  apiUrl: string,
  tabId: number,
): Promise<DiagnoseResponse> {
  return post<DiagnoseResponse>("diagnose", request, apiUrl, tabId);
}

/** Whether to accept a browser dialog the page opened during a run, decided by Jev. */
export function requestDialogDecision(
  request: DialogRequest,
  apiUrl: string,
  tabId: number,
): Promise<DialogResponse> {
  return post<DialogResponse>("dialog", request, apiUrl, tabId);
}

/** The code or link a site emailed the applicant, found in their Gmail by Jev. */
export function requestMailVerification(
  request: MailVerificationRequest,
  apiUrl: string,
  tabId: number,
): Promise<MailVerificationResponse> {
  return post<MailVerificationResponse>("mail-verification", request, apiUrl, tabId);
}
