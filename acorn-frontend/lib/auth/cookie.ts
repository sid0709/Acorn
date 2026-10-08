import { cookies } from "next/headers";

import { encodeAccountSnapshot } from "./account-snapshot";
import { ACCOUNT_COOKIE, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "./constants";

import type { AcornAccount } from "./account-snapshot";

function cookieBase(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

/** Saves the session and drops any account snapshot, so a new login cannot show the previous person. */
export async function writeSessionCookie(token: string, maxAge = SESSION_MAX_AGE_SECONDS) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieBase(maxAge));
  jar.set(ACCOUNT_COOKIE, "", cookieBase(0));
}

/** Saves who the session belongs to. A later navigation reads this instead of calling /me. */
export async function writeAccountCookie(account: AcornAccount, maxAge = SESSION_MAX_AGE_SECONDS) {
  (await cookies()).set(ACCOUNT_COOKIE, encodeAccountSnapshot(account), cookieBase(maxAge));
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", cookieBase(0));
  jar.set(ACCOUNT_COOKIE, "", cookieBase(0));
}

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? "";
}

export async function accountCookie() {
  return (await cookies()).get(ACCOUNT_COOKIE)?.value;
}
