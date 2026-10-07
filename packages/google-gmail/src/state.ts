/** Where acorn-frontend serves Gmail OAuth (separate from sign-in). */
export const GMAIL_AUTH_ROUTE = "/auth/gmail";
export const GMAIL_CALLBACK_ROUTE = `${GMAIL_AUTH_ROUTE}/callback`;

export const GMAIL_STATE_COOKIE = "gmail_connect_state";
export const GMAIL_STATE_MAX_AGE_SECONDS = 10 * 60;

export type GmailConnectState = { state: string; next: string };

export function encodeGmailState({ state, next }: GmailConnectState): string {
  return `${state}.${encodeURIComponent(next)}`;
}

export function decodeGmailState(value: string | undefined): GmailConnectState | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  try {
    return { state: value.slice(0, dot), next: decodeURIComponent(value.slice(dot + 1)) };
  } catch {
    return null;
  }
}

export function gmailStateCookie(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: GMAIL_AUTH_ROUTE,
    maxAge: GMAIL_STATE_MAX_AGE_SECONDS,
  };
}
