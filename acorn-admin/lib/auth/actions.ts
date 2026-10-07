"use server";

import { redirect } from "next/navigation";

import { acornApiUrl } from "../config";
import { ADMIN_SIGN_IN_PATH, ADMIN_SIGN_OUT_PATH } from "./constants";
import { adminSessionToken, clearAdminSessionCookie, writeAdminSessionCookie } from "./cookie";
import { readApiError } from "../api/client";

export async function signInAction(email: string, password: string): Promise<boolean> {
  const res = await fetch(`${acornApiUrl()}${ADMIN_SIGN_IN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { token?: string };
  if (!data.token) return false;
  await writeAdminSessionCookie(data.token);
  redirect("/claims");
}

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
  redirect("/login");
}

export async function signInActionWithError(
  email: string,
  password: string,
): Promise<string | null> {
  const res = await fetch(`${acornApiUrl()}${ADMIN_SIGN_IN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  if (!res.ok) return await readApiError(res);
  const data = (await res.json()) as { token?: string };
  if (!data.token) return "Sign-in did not return a session.";
  await writeAdminSessionCookie(data.token);
  redirect("/claims");
}
