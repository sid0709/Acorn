import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "./constants";

/** Saves the session; a support session passes its shorter lifetime in seconds. */
export async function writeSessionCookie(token: string, maxAge = SESSION_MAX_AGE_SECONDS) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function clearSessionCookie() {
  (await cookies()).set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? "";
}
