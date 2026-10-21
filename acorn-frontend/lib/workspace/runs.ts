import { ACORN_RUNS_API, type CompletedRun, type RunDay } from "@acorn/shared/runs";

import { sessionToken } from "@/lib/auth/cookie";
import { acornHeaders } from "@/lib/auth/headers";
import { acornApiUrl } from "@/lib/config";

import type { Day } from "./dates";
import { RECENT_RUNS, historyWindow, type RunProgressData } from "./progress";

/**
 * Server-only reads of the applications Acorn sent, from acorn-backend's run routes, as the
 * signed-in person. Pages call these while rendering.
 */

type Read<T> = { ok: true; data: T } | { ok: false; message: string };
type ErrorBody = { message?: string; error?: string };

const UNREACHABLE = "Couldn’t reach Acorn. Check that the API is running.";

async function read<T>(path: string, query: URLSearchParams): Promise<Read<T>> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: "Sign in required." };
  const response = await fetch(`${acornApiUrl()}${path}?${query}`, {
    headers: acornHeaders(token),
    cache: "no-store",
  }).catch(() => null);
  if (!response) return { ok: false, message: UNREACHABLE };
  const data = (await response.json().catch(() => ({}))) as T & ErrorBody;
  if (!response.ok) return { ok: false, message: data.message || data.error || "Request failed." };
  return { ok: true, data };
}

/** The days the account sent applications on, and its newest applications. */
export async function loadRunProgress(today: Day): Promise<RunProgressData> {
  const window = historyWindow(today);
  const [days, recent] = await Promise.all([
    read<{ days?: RunDay[] }>(
      ACORN_RUNS_API.daily,
      new URLSearchParams({ from: window.from, to: window.to }),
    ),
    read<{ runs?: CompletedRun[] }>(
      ACORN_RUNS_API.runs,
      new URLSearchParams({ limit: String(RECENT_RUNS) }),
    ),
  ]);
  if (!days.ok) return days;
  if (!recent.ok) return recent;
  return { ok: true, days: days.data.days ?? [], recent: recent.data.runs ?? [] };
}
