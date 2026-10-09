import { authHeaders, getAcornApiUrl } from "../auth/acorn-auth";
import { broadcastOperatorNotice } from "../operator-notice";

/** Shown when debug capture cannot record; the detail says why and what to do. */
const DEBUG_UNRECORDED = "Debug capture isn't recording";

/** Problems already shown, so a run that keeps tracing does not repeat them. */
const reported = new Set<string>();

function report(key: string, detail: string): void {
  console.warn(`[acorn debug] ${detail}`);
  if (reported.has(key)) return;
  reported.add(key);
  broadcastOperatorNotice({ kind: "error", title: DEBUG_UNRECORDED, detail });
}

/** Why a debug upload to base was refused, in words the person can act on. */
function refusal(base: string, status: number): string {
  if (status === 404) {
    return `${base} has no debug capture. Run the local API with ACORN_DEBUG_DIR set (acorn-backend/.env).`;
  }
  if (status === 401 || status === 403) {
    return `Sign in to Acorn on ${base} so debug capture can record.`;
  }
  return `${base} refused debug capture (HTTP ${status}).`;
}

/**
 * Send one debug upload (trace entries, a screenshot) to the API's debug routes.
 * Capture is best effort and never stops a run, but a failure is said once
 * instead of being dropped silently.
 */
export async function postDebug(path: string, body: unknown, tabId?: number): Promise<void> {
  const base = (await getAcornApiUrl()).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: await authHeaders(tabId),
      body: JSON.stringify(body),
    });
    if (!res.ok) report(`${base}|${res.status}`, refusal(base, res.status));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    report(`${base}|unreachable`, `Can't reach ${base} for debug capture: ${reason}`);
  }
}
