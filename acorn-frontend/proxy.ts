import { NextResponse, type NextRequest } from "next/server";

import {
  decodeAccountSnapshot,
  encodeAccountSnapshot,
  fetchAccount,
} from "@/lib/auth/account-snapshot";
import {
  ACCOUNT_COOKIE,
  ACCOUNT_HEADER,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/constants";

/**
 * Keeps a short-lived account snapshot next to the session cookie.
 * A fresh snapshot lets the workspace render without calling /acorn/auth/me.
 * A stale one is refreshed here, and the new value is also passed on this
 * request so the page that triggered the refresh does not call /me again.
 */
export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(ACCOUNT_HEADER);

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.next({ request: { headers: requestHeaders } });

  if (decodeAccountSnapshot(request.cookies.get(ACCOUNT_COOKIE)?.value)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const account = await fetchAccount(token);
  if (!account) return NextResponse.next({ request: { headers: requestHeaders } });

  const snapshot = encodeAccountSnapshot(account);
  requestHeaders.set(ACCOUNT_HEADER, snapshot);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.set(ACCOUNT_COOKIE, snapshot, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|manifest.webmanifest|downloads/).*)",
  ],
};
