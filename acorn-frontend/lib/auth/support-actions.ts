"use server";

import { ACORN_SUPPORT_EXTENSION_CODE_PATH } from "@acorn/shared/api";
import { acornApiUrl } from "@/lib/config";
import { sessionToken } from "./cookie";
import { acornHeaders } from "./headers";

export type ExtensionCodeResult = { ok: true; code: string } | { ok: false; error: string };

/** A fresh one-time code that signs the extension into this support session. */
export async function extensionSupportCode(): Promise<ExtensionCodeResult> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "This browser has no Acorn session." };
  const response = await fetch(`${acornApiUrl()}${ACORN_SUPPORT_EXTENSION_CODE_PATH}`, {
    method: "POST",
    headers: acornHeaders(token),
    cache: "no-store",
  }).catch(() => null);
  const body = ((await response?.json().catch(() => ({}))) ?? {}) as {
    code?: string;
    error?: string;
    message?: string;
  };
  if (!response?.ok || !body.code) {
    return { ok: false, error: body.error || body.message || "Couldn’t reach Acorn." };
  }
  return { ok: true, code: body.code };
}
