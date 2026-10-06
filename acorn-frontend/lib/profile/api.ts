"use server";

import { acornApiUrl } from "@/lib/config";
import { sessionToken } from "@/lib/auth/cookie";
import type { ApplicantProfile } from "@/lib/workspace/profile";
import type { ResumeUpload } from "@/lib/workspace/resume-file";

export type ProfileCall<T> = { ok: true; data: T } | { ok: false; message: string };

/** Who read an uploaded résumé: the AI model, or the layout parser when no model answered. */
export type ResumeReader = "ai" | "layout";

type ProfileBody = {
  stored: boolean;
  profile: ApplicantProfile;
  reader?: ResumeReader;
  message?: string;
  error?: string;
};

async function authed(path: string, init?: RequestInit): Promise<Response | ProfileCall<never>> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: "Sign in required." };
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${acornApiUrl()}/acorn/profile${path}`, {
    ...init,
    headers,
    cache: "no-store",
  }).catch(() => null);
  if (!response)
    return { ok: false, message: "Couldn’t reach Acorn. Check that the API is running." };
  return response;
}

async function read(path: string, init?: RequestInit): Promise<ProfileCall<ProfileBody>> {
  const response = await authed(path, init);
  if (!(response instanceof Response)) return response;
  const data = (await response.json().catch(() => ({}))) as ProfileBody;
  if (!response.ok) return { ok: false, message: data.message || data.error || "Request failed." };
  return { ok: true, data };
}

export async function loadProfile(): Promise<ProfileCall<ProfileBody>> {
  return read("");
}

export async function saveProfile(profile: ApplicantProfile): Promise<ProfileCall<ProfileBody>> {
  return read("", { method: "PUT", body: JSON.stringify(profile) });
}

export async function fillProfileFromResume(
  input: ResumeUpload & { profile: ApplicantProfile },
): Promise<ProfileCall<ProfileBody>> {
  return read("/from-resume", { method: "POST", body: JSON.stringify(input) });
}
