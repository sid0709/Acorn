import { seeOther } from "@acorn/google-signin";
import { AUTH_SUPPORT_REDEEM_PATH } from "@/lib/auth/constants";
import { establishSession } from "@/lib/auth/session";
import { acornApiUrl } from "@/lib/config";
import { ROUTES } from "@/lib/routes";
import { SUPPORT_PARAM } from "@/lib/support";

type RedeemBody = {
  token?: string;
  extensionCode?: string;
  session?: { expiresAt?: string };
  error?: string;
  message?: string;
};

function landing(params: Record<string, string>) {
  return seeOther(`${ROUTES.supportSession}?${new URLSearchParams(params)}`);
}

/**
 * An admin's "Sign in as user" link lands here. The one-time code becomes a
 * support session cookie, and the next page hands a second code to the extension.
 */
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.trim() ?? "";
  if (!code) return landing({ [SUPPORT_PARAM.error]: "This support link has no code." });
  const response = await fetch(`${acornApiUrl()}${AUTH_SUPPORT_REDEEM_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    cache: "no-store",
  }).catch(() => null);
  const body = ((await response?.json().catch(() => ({}))) ?? {}) as RedeemBody;
  if (!response?.ok || !body.token) {
    return landing({
      [SUPPORT_PARAM.error]: body.error || body.message || "Couldn’t open the support session.",
    });
  }
  const expiresAt = Date.parse(body.session?.expiresAt ?? "");
  const maxAge = Number.isFinite(expiresAt)
    ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
    : undefined;
  await establishSession(body.token, maxAge);
  return landing(body.extensionCode ? { [SUPPORT_PARAM.extensionCode]: body.extensionCode } : {});
}
