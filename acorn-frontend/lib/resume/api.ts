"use server";

import { acornApiUrl } from "@/lib/config";
import { sessionToken } from "@/lib/auth/cookie";
import {
  RESUME_API,
  historyQueryString,
  type ResumeGeneratePoll,
  type ResumeGenerateRequest,
} from "@acorn/shared/resume-api";
import type { ResumeGeneratorConfig } from "@acorn/shared/resume-config";
import type { ResumeIdentity } from "@acorn/shared/resume-content";
import type {
  ResumeHistoryPage,
  ResumeHistoryQuery,
  ResumeHistoryRun,
} from "@acorn/shared/resume-history";
import type { ResumeLibraryRow } from "@acorn/shared/resume-library";

export type ResumeCall<T> = { ok: true; data: T } | { ok: false; message: string };

type ErrorBody = { message?: string; error?: string };

async function authed(path: string, init?: RequestInit): Promise<Response | ResumeCall<never>> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: "Sign in required." };
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${acornApiUrl()}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  }).catch(() => null);
  if (!response)
    return { ok: false, message: "Couldn’t reach Acorn. Check that the API is running." };
  return response;
}

async function read<T>(path: string, init?: RequestInit): Promise<ResumeCall<T>> {
  const response = await authed(path, init);
  if (!(response instanceof Response)) return response;
  const data = (await response.json().catch(() => ({}))) as T & ErrorBody;
  if (!response.ok) return { ok: false, message: data.message || data.error || "Request failed." };
  return { ok: true, data };
}

export async function loadResumeConfig(): Promise<ResumeCall<{ config: ResumeGeneratorConfig }>> {
  return read(RESUME_API.config);
}

export async function saveResumeConfig(
  config: ResumeGeneratorConfig,
): Promise<ResumeCall<{ config: ResumeGeneratorConfig }>> {
  return read(RESUME_API.config, { method: "PUT", body: JSON.stringify(config) });
}

export async function listResumeTemplates(): Promise<
  ResumeCall<{ templates: { id: string; name: string; warnings: string[] }[] }>
> {
  return read(RESUME_API.templates);
}

export async function uploadResumeTemplate(input: {
  name: string;
  fileName: string;
  contentBase64: string;
}): Promise<ResumeCall<{ template: { id: string; name: string; warnings: string[] } }>> {
  return read(RESUME_API.templates, { method: "POST", body: JSON.stringify(input) });
}

export async function deleteResumeTemplate(id: string): Promise<ResumeCall<{ success: true }>> {
  return read(RESUME_API.template(id), { method: "DELETE" });
}

export async function previewResume(input: {
  identity: ResumeIdentity;
  sections?: Record<string, unknown>;
  config: ResumeGeneratorConfig;
}): Promise<ResumeCall<{ html: string }>> {
  return read(RESUME_API.preview, { method: "POST", body: JSON.stringify(input) });
}

export async function startResumeGenerate(
  input: ResumeGenerateRequest,
): Promise<ResumeCall<{ inputId: string }>> {
  return read(RESUME_API.generate, { method: "POST", body: JSON.stringify(input) });
}

export async function pollResumeGenerate(inputId: string): Promise<ResumeCall<ResumeGeneratePoll>> {
  return read(RESUME_API.generatePoll(inputId));
}

export async function previewGeneration(id: string): Promise<ResumeCall<{ html: string }>> {
  return read(RESUME_API.generationPreview(id));
}

export async function downloadGeneration(
  id: string,
): Promise<ResumeCall<{ name: string; base64: string }>> {
  const response = await authed(RESUME_API.generationDocx(id));
  if (!(response instanceof Response)) return response;
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as ErrorBody;
    return { ok: false, message: data.message || data.error || "Download failed." };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const name =
    /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] ||
    "Resume.docx";
  return { ok: true, data: { name, base64: Buffer.from(bytes).toString("base64") } };
}

export async function listGenerations(
  query: ResumeHistoryQuery,
): Promise<ResumeCall<ResumeHistoryPage>> {
  return read(`${RESUME_API.generations}${historyQueryString(query)}`);
}

export async function deleteGeneration(id: string): Promise<ResumeCall<{ success: true }>> {
  return read(RESUME_API.generation(id), { method: "DELETE" });
}

export async function loadGeneration(id: string): Promise<ResumeCall<{ run: ResumeHistoryRun }>> {
  return read(RESUME_API.generation(id));
}

export async function listLibrary(): Promise<ResumeCall<{ resumes: ResumeLibraryRow[] }>> {
  return read(RESUME_API.library);
}

export async function uploadLibraryFile(input: {
  fileName: string;
  title: string;
  contentBase64: string;
}): Promise<ResumeCall<{ resume: ResumeLibraryRow }>> {
  return read(RESUME_API.library, { method: "POST", body: JSON.stringify(input) });
}

export async function deleteLibraryFile(id: string): Promise<ResumeCall<{ success: true }>> {
  return read(RESUME_API.libraryItem(id), { method: "DELETE" });
}

export async function analyzeLibraryFile(
  id: string,
): Promise<ResumeCall<{ resume: ResumeLibraryRow }>> {
  return read(RESUME_API.libraryAnalyze(id), { method: "POST" });
}

export async function makeLibraryPrimary(
  id: string,
): Promise<ResumeCall<{ resume: ResumeLibraryRow }>> {
  return read(RESUME_API.libraryPrimary(id), { method: "POST" });
}
