import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "./lib/auth/constants";

const PUBLIC = new Set(["/login"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.has(pathname) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
