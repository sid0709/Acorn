/**
 * Reads whether this signed-in Acorn account already has Gmail connected on the
 * website (Connections → Gmail). Same session and backend as acorn-frontend; no
 * separate extension OAuth.
 */

import { ACORN_GMAIL_API, type AcornGmailMailboxesResponse } from "@acorn/shared/gmail";

import { authHeaders, getAcornApiUrl } from "../auth/acorn-auth";

export interface GmailConnectionStatus {
  connected: boolean;
  email?: string;
  mailboxCount: number;
}

export async function fetchGmailConnectionStatus(
  token: string | undefined,
  apiUrl?: string,
): Promise<GmailConnectionStatus> {
  if (!token) {
    return { connected: false, mailboxCount: 0 };
  }
  const base = (apiUrl ?? (await getAcornApiUrl())).replace(/\/$/, "");
  try {
    const response = await fetch(`${base}${ACORN_GMAIL_API.mailboxes}`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return { connected: false, mailboxCount: 0 };
    }
    const body = (await response.json()) as AcornGmailMailboxesResponse;
    const mailboxes = body.mailboxes ?? [];
    const primary = mailboxes.find((box) => box.isDefault) ?? mailboxes[0];
    return {
      connected: mailboxes.length > 0,
      email: primary?.email,
      mailboxCount: mailboxes.length,
    };
  } catch {
    return { connected: false, mailboxCount: 0 };
  }
}
