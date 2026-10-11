import { cache } from "react";

import { acornApiUrl } from "../config";

import { ADMIN_AUTH_ME_PATH } from "./constants";
import { adminSessionToken } from "./cookie";

/**
 * How long a checked session is trusted without asking acorn-backend again. Every API call
 * still sends the token, so a revoked session fails there; this only spares each page load
 * a round trip before it can start rendering.
 */
const SESSION_CHECK_TTL_MS = 60_000;
/** Checked sessions remembered at once; the oldest is dropped past this. */
const SESSION_CHECK_MAX = 256;

const checked = new Map<string, { email: string; until: number }>();

/** The admin email behind this browser's session cookie, or null when signed out. */
export const currentAdminEmail = cache(async (): Promise<string | null> => {
  const token = await adminSessionToken();
  if (!token) return null;
  const hit = checked.get(token);
  if (hit && hit.until > Date.now()) return hit.email;
  const email = await lookupAdminEmail(token);
  if (email) {
    checked.set(token, { email, until: Date.now() + SESSION_CHECK_TTL_MS });
    if (checked.size > SESSION_CHECK_MAX) checked.delete(checked.keys().next().value!);
  } else {
    checked.delete(token);
  }
  return email;
});

/** Forgets a session, so signing out takes effect on the next page. */
export function forgetAdminSession(token: string) {
  checked.delete(token);
}

async function lookupAdminEmail(token: string): Promise<string | null> {
  const response = await fetch(`${acornApiUrl()}${ADMIN_AUTH_ME_PATH}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json()) as { session?: { email?: string } };
  const email = body.session?.email?.trim();
  return email || null;
}
