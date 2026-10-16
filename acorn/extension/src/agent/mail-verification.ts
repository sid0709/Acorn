/**
 * Reads the applicant's connected Gmail for a job site's verification code or link.
 * Values are confirmed in the email body before use (see acorn-backend/mailcode).
 */

import { authHeaders, getAcornApiUrl } from "../auth/acorn-auth";

import { AGENT_STOP_REASON, type AgentStop } from "@acorn/shared/agent-contract";
import { ACORN_GMAIL_API } from "@acorn/shared/gmail";
import {
  MAIL_VERIFICATION_STATUS,
  VERIFICATION,
  type MailVerificationStatus,
  type VerificationKind,
} from "@acorn/shared/run-types";

const MAIL_POLL_MS = 5_000;

export interface MailVerificationRequest {
  runId: string;
  step: number;
  kind: VerificationKind;
  url: string;
  title: string;
  text: string;
  since: number;
  seen: string;
}

export interface MailVerificationResponse {
  ok: boolean;
  error?: string;
  status?: MailVerificationStatus | "no_mailbox";
  value?: string;
  seen?: string;
  unchanged?: boolean;
}

export function guessVerificationKind(pageText: string, stop?: AgentStop): VerificationKind {
  const text = `${stop?.problem ?? ""} ${stop?.action ?? ""} ${pageText}`.toLowerCase();
  if (/\blink\b|verify.*url|click.*email|confirm.*email/.test(text)) {
    return VERIFICATION.emailLink;
  }
  return VERIFICATION.emailCode;
}

export async function requestMailVerification(
  request: MailVerificationRequest,
  token: string | undefined,
  apiUrl?: string,
  signal?: AbortSignal,
): Promise<MailVerificationResponse> {
  const base = (apiUrl ?? (await getAcornApiUrl())).replace(/\/$/, "");
  const response = await fetch(`${base}${ACORN_GMAIL_API.mailVerification}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(request),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(65_000)])
      : AbortSignal.timeout(65_000),
  });
  const body = (await response.json()) as MailVerificationResponse;
  if (!response.ok && body.ok !== true) {
    return { ok: false, error: body.error ?? `HTTP ${response.status}` };
  }
  return body;
}

export type MailVerificationOutcome =
  | { ok: true; kind: VerificationKind; value: string }
  | { ok: false; reason: "no_mailbox" | "not_found" | "timeout" | "error"; detail?: string };

/** Polls Gmail until a code or link is found, the window ends, or the run stops. */
export async function waitForMailVerification(args: {
  runId: string;
  step: number;
  kind: VerificationKind;
  url: string;
  title: string;
  pageText: string;
  sinceMs: number;
  windowMs: number;
  token?: string;
  apiUrl?: string;
  signal?: AbortSignal;
  onPoll?: () => void;
}): Promise<MailVerificationOutcome> {
  const deadline = args.sinceMs + args.windowMs;
  let seen = "";
  while (Date.now() < deadline) {
    if (args.signal?.aborted) {
      return { ok: false, reason: "timeout" };
    }
    args.onPoll?.();
    const response = await requestMailVerification(
      {
        runId: args.runId,
        step: args.step,
        kind: args.kind,
        url: args.url,
        title: args.title,
        text: args.pageText,
        since: args.sinceMs,
        seen,
      },
      args.token,
      args.apiUrl,
      args.signal,
    );
    if (!response.ok) {
      return { ok: false, reason: "error", detail: response.error };
    }
    if (response.status === MAIL_VERIFICATION_STATUS.noMailbox) {
      return { ok: false, reason: "no_mailbox" };
    }
    if (response.status === MAIL_VERIFICATION_STATUS.found && response.value) {
      return { ok: true, kind: args.kind, value: response.value };
    }
    if (response.status === MAIL_VERIFICATION_STATUS.notFound) {
      return { ok: false, reason: "not_found" };
    }
    seen = response.seen ?? seen;
    await sleep(MAIL_POLL_MS, args.signal);
  }
  return { ok: false, reason: "timeout" };
}

export function noteForVerification(kind: VerificationKind, value: string): string {
  if (kind === VERIFICATION.emailLink) {
    return (
      "Acorn read this verification link from your Gmail (confirmed in the message): " +
      value +
      ". Open it in this tab if the page asks you to, then finish the step."
    );
  }
  return (
    "Acorn read this verification code from your Gmail (confirmed in the message body): " +
    value +
    ". Type it into the code field(s) on the page and submit."
  );
}

/** True when the agent stopped for an emailed code or link we can try to read from Gmail. */
export function isEmailVerificationStop(reason: string | undefined): boolean {
  return reason === AGENT_STOP_REASON.verification;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}
