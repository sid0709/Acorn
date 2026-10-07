import { cookies } from "next/headers";
import {
  GMAIL_STATE_COOKIE,
  encodeGmailState,
  gmailStateCookie,
  gmailErrorPath,
  seeOther,
  startGmailConnect,
} from "@acorn/google-gmail";
import { acornApiUrl } from "@/lib/config";
import { sessionToken } from "@/lib/auth/cookie";
import { ROUTES, safeNextPath } from "@/lib/routes";

/** Starts Gmail OAuth after the person enters which address to connect. */
export async function POST(request: Request) {
  const token = await sessionToken();
  if (!token) return seeOther(ROUTES.signIn);

  const form = await request.formData().catch(() => null);
  const email = typeof form?.get("email") === "string" ? String(form.get("email")) : "";
  const label = typeof form?.get("label") === "string" ? String(form.get("label")) : "";
  const next = safeNextPath(
    typeof form?.get("next") === "string" ? String(form.get("next")) : undefined,
  );

  const reauthorize = form?.get("reauthorize") === "1";
  const started = await startGmailConnect(
    acornApiUrl(),
    email,
    label,
    { Authorization: `Bearer ${token}` },
    reauthorize,
  );
  if (!started.ok) {
    return seeOther(gmailErrorPath(ROUTES.gmailConnect, started.error, next));
  }
  (await cookies()).set(
    GMAIL_STATE_COOKIE,
    encodeGmailState({ state: started.state, next }),
    gmailStateCookie(process.env.NODE_ENV === "production"),
  );
  return seeOther(started.url);
}
