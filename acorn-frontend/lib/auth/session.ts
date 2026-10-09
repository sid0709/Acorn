import { headers } from "next/headers";
import { cache } from "react";

import { decodeAccountSnapshot, fetchAccount, type AcornAccount } from "./account-snapshot";
import { ACCOUNT_HEADER, SESSION_MAX_AGE_SECONDS } from "./constants";
import { accountCookie, sessionToken, writeAccountCookie, writeSessionCookie } from "./cookie";

export type { AcornAccount } from "./account-snapshot";

/**
 * Writes the session and a snapshot of the account, so the next page does not
 * wait on /acorn/auth/me. A support session passes its shorter lifetime.
 */
export async function establishSession(token: string, maxAge = SESSION_MAX_AGE_SECONDS) {
  await writeSessionCookie(token, maxAge);
  const account = await fetchAccount(token);
  if (account) await writeAccountCookie(account, maxAge);
}

/** The Acorn account behind this browser's session cookie, or null when signed out. */
export const currentAccount = cache(async (): Promise<AcornAccount | null> => {
  const token = await sessionToken();
  if (!token) return null;
  const cached = decodeAccountSnapshot(await accountCookie());
  if (cached) return cached;
  const refreshed = decodeAccountSnapshot((await headers()).get(ACCOUNT_HEADER) ?? undefined);
  if (refreshed) return refreshed;
  return fetchAccount(token);
});
