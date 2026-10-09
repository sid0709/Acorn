"use server";

import { acornApiUrl } from "@/lib/config";
import {
  AUTH_ACCOUNT_PATH,
  AUTH_SIGN_IN_PATH,
  AUTH_SIGN_OUT_PATH,
  AUTH_SIGN_UP_PATH,
} from "./constants";
import { clearSessionCookie, sessionToken } from "./cookie";
import { establishSession } from "./session";

export type AuthResult = { ok: true } | { ok: false; message: string };

export async function signIn(email: string, password: string): Promise<AuthResult> {
  return openSession(AUTH_SIGN_IN_PATH, { email, password });
}

export async function signUp(name: string, email: string, password: string): Promise<AuthResult> {
  return openSession(AUTH_SIGN_UP_PATH, { name, email, password });
}

export async function signOut(): Promise<void> {
  const token = await sessionToken();
  if (token) {
    await fetch(`${acornApiUrl()}${AUTH_SIGN_OUT_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }).catch(() => undefined);
  }
  await clearSessionCookie();
}

export async function deleteAccount(): Promise<AuthResult> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: "Sign in required." };
  const response = await fetch(`${acornApiUrl()}${AUTH_ACCOUNT_PATH}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  if (!response) {
    return { ok: false, message: "Couldn’t reach Acorn. Check that the API is running." };
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };
    return {
      ok: false,
      message: payload.message || payload.error || "Couldn’t delete the account.",
    };
  }
  await clearSessionCookie();
  return { ok: true };
}

async function openSession(path: string, body: Record<string, string>): Promise<AuthResult> {
  const response = await fetch(`${acornApiUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => null);
  if (!response) {
    return { ok: false, message: "Couldn’t reach Acorn. Check that the API is running." };
  }
  const payload = (await response.json().catch(() => ({}))) as {
    token?: string;
    message?: string;
    error?: string;
  };
  if (!response.ok || !payload.token) {
    return { ok: false, message: payload.message || payload.error || "Couldn’t sign in." };
  }
  await establishSession(payload.token);
  return { ok: true };
}
