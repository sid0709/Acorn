import { GMAIL_ERROR_PARAM, type GmailConnectError } from "./messages";
import { decodeGmailState } from "./state";

const START_PATH = "/acorn/gmail/connect/start";
const FINISH_PATH = "/acorn/gmail/connect/finish";

export type GmailStarted =
  { ok: true; url: string; state: string } | { ok: false; error: GmailConnectError };

export type GmailFinished =
  { ok: true; next: string } | { ok: false; error: GmailConnectError; next: string };

export async function startGmailConnect(
  apiUrl: string,
  email: string,
  label: string,
  headers: Record<string, string> = {},
): Promise<GmailStarted> {
  try {
    const response = await fetch(new URL(START_PATH, `${apiUrl}/`), {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ email, label }),
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, error: errorFor(response.status) };
    const { url, state } = (await response.json()) as { url: string; state: string };
    return { ok: true, url, state };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function finishGmailConnect(
  apiUrl: string,
  callback: URL,
  cookie: string | undefined,
  headers: Record<string, string> = {},
): Promise<GmailFinished> {
  const saved = decodeGmailState(cookie);
  const next = saved?.next ?? "";
  const params = callback.searchParams;
  if (params.has("error")) {
    return {
      ok: false,
      error: params.get("error") === "access_denied" ? "cancelled" : "failed",
      next,
    };
  }
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || !saved || saved.state !== state) {
    return { ok: false, error: "expired", next };
  }
  try {
    const response = await fetch(new URL(FINISH_PATH, `${apiUrl}/`), {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ code, state }),
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, error: errorFor(response.status), next };
    return { ok: true, next };
  } catch {
    return { ok: false, error: "failed", next };
  }
}

function errorFor(status: number): GmailConnectError {
  switch (status) {
    case 400:
      return "expired";
    case 403:
    case 409:
      return "wrong_account";
    case 503:
      return "unavailable";
    default:
      return "failed";
  }
}

export function gmailErrorPath(gmailPath: string, error: GmailConnectError, next: string): string {
  const query = new URLSearchParams({ [GMAIL_ERROR_PARAM]: error });
  if (next) query.set("next", next);
  return `${gmailPath}?${query}`;
}

export function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}
