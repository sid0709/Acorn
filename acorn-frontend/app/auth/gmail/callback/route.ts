import { cookies } from "next/headers";
import {
  GMAIL_STATE_COOKIE,
  finishGmailConnect,
  gmailErrorPath,
  gmailStateCookie,
  seeOther,
} from "@acorn/google-gmail";
import { acornApiUrl } from "@/lib/config";
import { sessionToken } from "@/lib/auth/cookie";
import { ROUTES, safeNextPath } from "@/lib/routes";

/** Google returns here after Gmail consent; the API stores the refresh token. */
export async function GET(request: Request) {
  const token = await sessionToken();
  if (!token) return seeOther(ROUTES.signIn);

  const jar = await cookies();
  const result = await finishGmailConnect(
    acornApiUrl(),
    new URL(request.url),
    jar.get(GMAIL_STATE_COOKIE)?.value,
    { Authorization: `Bearer ${token}` },
  );
  jar.set(GMAIL_STATE_COOKIE, "", {
    ...gmailStateCookie(process.env.NODE_ENV === "production"),
    maxAge: 0,
  });
  const next = safeNextPath(result.next || ROUTES.gmail);
  if (!result.ok) return seeOther(gmailErrorPath(ROUTES.gmailConnect, result.error, next));
  return seeOther(next);
}
