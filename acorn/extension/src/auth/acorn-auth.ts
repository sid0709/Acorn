import { ACORN_SOCKET_PATH, acornHosts } from "@acorn/shared/api";
import { ACORN_TAB_HEADER, usageTabKey } from "../tab-usage-key";

const hosts = acornHosts(import.meta.env.MODE);

/** Acorn's API. Override per build with VITE_ACORN_API_URL. */
export const DEFAULT_ACORN_API_URL = import.meta.env.VITE_ACORN_API_URL?.trim() || hosts.api;
export { ACORN_SOCKET_PATH };

/** Where acorn-frontend runs. Override per build with VITE_ACORN_WEB_URL. */
export const DEFAULT_ACORN_WEB_URL = import.meta.env.VITE_ACORN_WEB_URL?.trim() || hosts.web;

export type AcornStoredSession = {
  accessToken: string;
  username: string;
  displayName: string;
  profileId: string;
  expiresAt: string;
};

const STORAGE_KEYS = {
  apiUrl: "acornApiUrl",
  session: "acornSession",
} as const;

const RETIRED_API_HOSTS = [["api", "joi", "nedhq", "com"].join(""), "acorn.remotepairnet.net"];

function retiredApiUrl(url: string): boolean {
  try {
    return RETIRED_API_HOSTS.includes(new URL(url).host);
  } catch {
    return false;
  }
}

export async function getAcornApiUrl(): Promise<string> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.apiUrl]);
  const value = stored[STORAGE_KEYS.apiUrl];
  if (typeof value === "string") {
    const url = value.trim().replace(/\/$/, "");
    if (url && !retiredApiUrl(url)) return url;
  }
  return DEFAULT_ACORN_API_URL;
}

/** Socket.io origin: the API host. Routes and the engine path both sit under `/acorn` there. */
export function acornSocketOrigin(apiUrl: string): string {
  return apiUrl
    .trim()
    .replace(/\/api\/?$/, "")
    .replace(/\/$/, "");
}

export async function setAcornApiUrl(url: string): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.apiUrl]: url.trim().replace(/\/$/, ""),
  });
}

export async function getAcornSession(): Promise<AcornStoredSession | null> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.session]);
  const session = stored[STORAGE_KEYS.session] as AcornStoredSession | undefined;
  if (!session?.accessToken) return null;
  if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
    await clearAcornSession();
    return null;
  }
  return session;
}

export async function setAcornSession(session: AcornStoredSession): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.session]: session });
}

export async function clearAcornSession(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEYS.session]);
}

export async function getAccessToken(): Promise<string | null> {
  const session = await getAcornSession();
  return session?.accessToken ?? null;
}

export type AcornAuthResult =
  { ok: true; session: AcornStoredSession } | { ok: false; error: string };

const SIGN_UP_PATH = "/sign-up";

export const ACORN_ACCOUNT_REQUIRED =
  "No Acorn account uses this Gmail. Create one on the Acorn site, then try again.";
export const ACORN_SESSION_REJECTED = "Acorn didn’t accept that Google sign-in. Try again.";

type GoogleStart = { url?: string; state?: string; message?: string };
type GoogleFinish = {
  token?: string;
  message?: string;
  session?: { username?: string; displayName?: string; profileId?: string };
};

/** Sign in with Google. A matching Gmail uses that Acorn account. A new Gmail does not create one. */
export async function acornSignIn(apiUrl?: string): Promise<AcornAuthResult> {
  const base = (apiUrl || (await getAcornApiUrl())).replace(/\/$/, "");
  const redirectUri = chrome.identity.getRedirectURL();
  try {
    const started = await postJSON<GoogleStart>(`${base}/acorn/auth/google/start`, { redirectUri });
    if (!started.ok || !started.data.url || !started.data.state) {
      return { ok: false, error: started.data.message || "Couldn’t start Google sign-in." };
    }
    const returned = await chrome.identity.launchWebAuthFlow({
      url: started.data.url,
      interactive: true,
    });
    if (chrome.runtime.lastError || !returned) {
      return { ok: false, error: "Google sign-in was cancelled." };
    }
    const params = new URL(returned).searchParams;
    if (params.get("error")) {
      return { ok: false, error: "Google sign-in was cancelled." };
    }
    const code = params.get("code");
    const state = params.get("state");
    if (!code || state !== started.data.state) {
      return { ok: false, error: ACORN_SESSION_REJECTED };
    }
    const finished = await postJSON<GoogleFinish>(`${base}/acorn/auth/google/finish`, {
      code,
      state,
    });
    if (finished.status === 404) {
      return {
        ok: false,
        error: `${ACORN_ACCOUNT_REQUIRED} ${DEFAULT_ACORN_WEB_URL}${SIGN_UP_PATH}`,
      };
    }
    if (!finished.ok || !finished.data.token || !finished.data.session) {
      return { ok: false, error: finished.data.message || "Couldn’t sign in." };
    }
    const session: AcornStoredSession = {
      accessToken: finished.data.token,
      username: finished.data.session.username || "",
      displayName: finished.data.session.displayName || finished.data.session.username || "Acorn",
      profileId: finished.data.session.profileId || "",
      expiresAt: "",
    };
    await setAcornApiUrl(base);
    await setAcornSession(session);
    return { ok: true, session };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "");
    if (/failed to fetch|networkerror|load failed/i.test(message)) {
      return {
        ok: false,
        error: "Couldn’t reach Acorn. Check the API URL and that the backend is running.",
      };
    }
    return { ok: false, error: message || "Couldn’t sign in." };
  }
}

async function postJSON<T extends { message?: string }>(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

/** End this extension's Acorn session. The website sign-in is left as it is. */
export async function acornSignOut(): Promise<void> {
  const token = await getAccessToken();
  const base = await getAcornApiUrl();
  if (token) {
    await fetch(`${base}/acorn/auth/signout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
  await clearAcornSession();
}

export async function authHeaders(tabId?: number | null): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) throw new Error("Sign in to Acorn required");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (typeof tabId === "number") {
    headers[ACORN_TAB_HEADER] = await usageTabKey(tabId);
  }
  return headers;
}
