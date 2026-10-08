import { acornApiUrl } from "@/lib/config";

import { ACCOUNT_SNAPSHOT_TTL_SECONDS, AUTH_ME_PATH } from "./constants";
import { acornHeaders } from "./headers";

export type AcornAccount = {
  id: string;
  name: string;
  email: string;
  /** Set when an admin opened this session to help the user: their email and when it ends. */
  support?: { by: string; expiresAt: string };
};

type SnapshotBody = {
  id?: string;
  name?: string;
  email?: string;
  exp?: number;
  support?: { by?: string; expiresAt?: string };
};

/** base64url JSON. Safe in a cookie and a request header, including non-ASCII names. */
export function encodeAccountSnapshot(account: AcornAccount, now = Date.now()): string {
  const body: SnapshotBody = {
    id: account.id,
    name: account.name,
    email: account.email,
    exp: Math.floor(now / 1000) + ACCOUNT_SNAPSHOT_TTL_SECONDS,
    support: account.support,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The account inside a snapshot, or null when it is missing, corrupt, or past its exp. */
export function decodeAccountSnapshot(
  raw: string | undefined,
  now = Date.now(),
): AcornAccount | null {
  if (!raw) return null;
  try {
    const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
    const binary = atob(raw.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as SnapshotBody;
    const name = parsed.name?.trim();
    const email = parsed.email?.trim();
    if (!name || !email || typeof parsed.exp !== "number" || parsed.exp * 1000 <= now) return null;
    const supportBy = parsed.support?.by?.trim();
    if (supportBy) {
      const expiresAt = Date.parse(parsed.support?.expiresAt ?? "");
      if (Number.isFinite(expiresAt) && expiresAt <= now) return null;
      return {
        id: parsed.id ?? "",
        name,
        email,
        support: { by: supportBy, expiresAt: parsed.support?.expiresAt ?? "" },
      };
    }
    return { id: parsed.id ?? "", name, email };
  } catch {
    return null;
  }
}

/** The account behind a session token, or null when the token is missing or refused. */
export async function fetchAccount(token: string): Promise<AcornAccount | null> {
  const response = await fetch(`${acornApiUrl()}${AUTH_ME_PATH}`, {
    headers: acornHeaders(token),
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json()) as {
    session?: {
      accountId?: string;
      displayName?: string;
      email?: string;
      supportBy?: string;
      expiresAt?: string;
    };
  };
  const name = body.session?.displayName?.trim();
  const email = body.session?.email?.trim();
  if (!name || !email) return null;
  const id = body.session?.accountId ?? "";
  const supportBy = body.session?.supportBy?.trim();
  return supportBy
    ? { id, name, email, support: { by: supportBy, expiresAt: body.session?.expiresAt ?? "" } }
    : { id, name, email };
}
