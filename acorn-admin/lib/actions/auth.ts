"use server";

import { redirect } from "next/navigation";

import { readApiError } from "../api/client";
import { ADMIN_SIGN_IN_PATH, ADMIN_SIGN_OUT_PATH } from "../auth/constants";
import {
  adminSessionToken,
  clearAdminSessionCookie,
  writeAdminSessionCookie,
} from "../auth/cookie";
import { acornApiUrl } from "../config";
import { ROUTES } from "../routes";

export async function signOutAction(): Promise<void> {
  const token = await adminSessionToken();
  if (token) {
    await fetch(`${acornApiUrl()}${ADMIN_SIGN_OUT_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }).catch(() => null);
  }
  await clearAdminSessionCookie();
  redirect(ROUTES.login);
}

/** Signs in and sets the session cookie; returns an error message, or null on success. */
export async function signInActionWithError(
  email: string,
  password: string,
): Promise<string | null> {
  const res = await fetch(`${acornApiUrl()}${ADMIN_SIGN_IN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  }).catch(() => null);
  if (!res) {
    return `acorn-backend is not reachable at ${acornApiUrl()}. Start it with bun run dev:acorn-api.`;
  }
  if (!res.ok) return await readApiError(res);
  const data = (await res.json()) as { token?: string };
  if (!data.token) return "Sign-in did not return a session.";
  await writeAdminSessionCookie(data.token);
  return null;
}
