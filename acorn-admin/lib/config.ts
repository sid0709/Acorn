/** Local acorn-backend. Override with ACORN_API_URL (same as acorn-frontend). */
const DEFAULT_API_URL = "http://127.0.0.1:8083";

export function acornApiUrl(): string {
  return (process.env.ACORN_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
}
