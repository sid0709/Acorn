export type GmailConnectError =
  "cancelled" | "expired" | "wrong_account" | "unavailable" | "failed";

export const GMAIL_ERROR_PARAM = "gmail_error";

const MESSAGES: Record<GmailConnectError, string> = {
  cancelled: "Gmail connection was cancelled.",
  expired: "This Gmail connection expired. Try again.",
  wrong_account:
    "Google signed in with a different address than you entered, or that Gmail is already connected.",
  unavailable: "Gmail is not available right now. Try again later.",
  failed: "Could not connect Gmail. Try again.",
};

export function gmailErrorMessage(code: string | null | undefined) {
  return code && code in MESSAGES ? MESSAGES[code as GmailConnectError] : "";
}
