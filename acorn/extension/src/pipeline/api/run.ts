import { authHeaders, getAcornApiUrl } from "../../auth/acorn-auth";

import type { AiUsageSummary } from "@acorn/shared/ai-usage";
import type { PageControl } from "@acorn/shared/page-controls";
import type {
  AccountAttempt,
  AccountMode,
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
  flagged: number;
  pageMessages: string[];
  /** Account steps the run already sent on this site, oldest first. */
  account: AccountAttempt[];
  /** The account step the run tries next on this site (create, sign in, or reset); absent off account steps. */
  accountGoal?: AccountMode;
}

export interface ReadPageResponse {
  ok: boolean;
  error?: string;
  kind?: PageKind;
  kindConfidence?: number;
  /** The control to click; null when nothing on the page moves the application forward. */
  control?: { id: number; role: ControlRole; confidence: number } | null;
  /**
   * When `control` is null on a form being advanced: the most probable forward
   * control anyway. The run clicks it before deciding the page is stuck.
   */
  fallback?: { id: number; role: ControlRole; confidence: number } | null;
  /** The page offers a way to go on without signing in or creating an account. */
  guest?: boolean;
  /** The page waits on something only the applicant can give (a code sent to them). */
  needsPerson?: boolean;
  /** What the page asks to verify; an email code or link is read from the applicant's Gmail. */
  verification?: Verification;
  /** What an account step asks for. */
  accountMode?: AccountMode;
  /** On an account step: whether the profile holds a default account password. */
  accountPassword?: boolean;
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
  reason?: string;
  label?: string;
  detail?: string;
  confidence?: number;
  usage?: AiUsageSummary;
}

async function post<T extends { ok: boolean; error?: string }>(
  path: string,
  body: unknown,
  apiUrl: string,
  tabId: number,
): Promise<T> {
  const base = (apiUrl || (await getAcornApiUrl())).replace(/\/$/, "");
  const res = await fetch(`${base}/acorn/run/${path}`, {
    method: "POST",
    headers: await authHeaders(tabId),
    body: JSON.stringify(body),
  });
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

/** Why a run stopped, decided by Jev from what the page flagged. */
export function requestDiagnose(
  request: DiagnoseRequest,
  apiUrl: string,
  tabId: number,
): Promise<DiagnoseResponse> {
  return post<DiagnoseResponse>("diagnose", request, apiUrl, tabId);
}

/** The code or link a site emailed the applicant, found in their Gmail by Jev. */
export function requestMailVerification(
  request: MailVerificationRequest,
  apiUrl: string,
  tabId: number,
): Promise<MailVerificationResponse> {
  return post<MailVerificationResponse>("mail-verification", request, apiUrl, tabId);
}
