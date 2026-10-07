import { adminSessionToken } from "../auth/cookie";
import { acornApiUrl } from "../config";

type ApiError = { error?: string; message?: string };

export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await adminSessionToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${acornApiUrl()}${path}`, { ...init, headers, cache: "no-store" });
}

export async function readApiError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as ApiError;
  return data.error || data.message || `Request failed (${res.status})`;
}

/** GETs JSON, or null on 404. Any other failure throws with the API's message. */
export async function adminJSON<T>(path: string): Promise<T | null> {
  const res = await adminFetch(path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await readApiError(res));
  return (await res.json()) as T;
}

/** Sends a JSON body and returns the parsed answer; failures throw with the API's message. */
export async function adminSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await adminFetch(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readApiError(res));
  return (await res.json()) as T;
}

/** A query string from the set values only, with a leading "?" when not empty. */
export function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== false) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
