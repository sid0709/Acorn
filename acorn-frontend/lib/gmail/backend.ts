import { sessionToken } from "@/lib/auth/cookie";
import { acornApiUrl } from "@/lib/config";

import { listParams } from "./query";
import type { GmailListQuery, GmailOverview, GmailPage } from "./types";
import { acornHeaders } from "@/lib/auth/headers";

/**
 * Server-only calls to acorn-backend's Gmail routes. Pages read through these while
 * rendering; the browser reads the same routes through app/api/gmail.
 */

export type GmailCall<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

type ErrorBody = { message?: string; error?: string };

const UNREACHABLE = "Couldn’t reach Acorn. Check that the API is running.";

/** Browser cache lifetimes for proxied reads. A message body never changes. */
const LIST_MAX_AGE_SECONDS = 15;
const MESSAGE_MAX_AGE_SECONDS = 600;

export const GMAIL_BACKEND = {
  mailboxes: "/acorn/gmail/mailboxes",
  messages: "/acorn/gmail/messages",
  overview: "/acorn/gmail/overview",
  guides: "/acorn/gmail/label-guides",
  autolabel: "/acorn/gmail/autolabel",
} as const;

async function call(path: string, init?: RequestInit): Promise<Response | null> {
  const token = await sessionToken();
  if (!token) return null;
  const headers = acornHeaders(token, init);
  return fetch(`${acornApiUrl()}${path}`, { ...init, headers, cache: "no-store" }).catch(
    () => null,
  );
}

export async function readGmail<T>(path: string, init?: RequestInit): Promise<GmailCall<T>> {
  const response = await call(path, init);
  if (!response) return { ok: false, status: 502, message: UNREACHABLE };
  const data = (await response.json().catch(() => ({}))) as T & ErrorBody;
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: data.message || data.error || "Request failed.",
    };
  }
  return { ok: true, data };
}

export function loadGmailOverview(mailboxId: string) {
  return readGmail<GmailOverview>(
    `${GMAIL_BACKEND.overview}?${new URLSearchParams({ mailboxId })}`,
  );
}

export function loadGmailPage(query: GmailListQuery) {
  return readGmail<GmailPage>(`${GMAIL_BACKEND.messages}?${listParams(query)}`);
}

/**
 * Forwards a browser read to acorn-backend with the session token, passing the
 * query through. Lists cache briefly in the browser; message bodies for longer.
 */
/** Forwards a browser write (or an uncached read) to acorn-backend with the session token. */
export async function proxyGmailWrite(request: Request, path: string) {
  const incoming = new URL(request.url).searchParams;
  const query = incoming.toString();
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const response = await call(`${path}${query ? `?${query}` : ""}`, {
    method: request.method,
    body: hasBody ? await request.text() : undefined,
  });
  if (!response) return Response.json({ message: UNREACHABLE }, { status: 502 });
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function proxyGmail(request: Request, path: string, kind: "list" | "message") {
  const incoming = new URL(request.url).searchParams;
  const response = await call(`${path}?${incoming}`);
  if (!response) return Response.json({ message: UNREACHABLE }, { status: 502 });
  const fresh = incoming.get("fresh") === "1";
  const maxAge = kind === "message" ? MESSAGE_MAX_AGE_SECONDS : LIST_MAX_AGE_SECONDS;
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": response.ok && !fresh ? `private, max-age=${maxAge}` : "no-store",
    },
  });
}
