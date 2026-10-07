/** Local acorn-backend. Override with ACORN_API_URL (same as acorn-frontend). */
const DEFAULT_API_URL = "http://127.0.0.1:8083";

export const BRAND = "Acorn Admin";

/** How long a support session lasts; account.SupportSessionTTL in acorn-backend. */
export const SUPPORT_SESSION_HOURS = 2;

/** How often an open claims inbox checks for new messages. */
export const CLAIMS_POLL_MS = 10_000;

export function acornApiUrl(): string {
  return (process.env.ACORN_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
}
