import { acornApiUrl } from "../config";
import { adminSessionToken } from "../auth/cookie";

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
