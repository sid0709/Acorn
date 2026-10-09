import { authHeaders, getAcornApiUrl } from "../../auth/acorn-auth";

import { extractError } from "./http";

import type { RuntimeAttachedFile } from "@acorn/shared/plan-runner/types";

/** The Library cover letter for a posting, and why it was chosen. */
export interface CoverLetterChoice {
  /** Null when the Library holds no cover letter. */
  file: RuntimeAttachedFile | null;
  stack: string | null;
  reason: string | null;
}

/**
 * Ask which Library cover letter fits the posting: the only one as it is, or the
 * best of several (Jev). The file comes with its stack's other formats.
 */
export async function requestCoverLetter(
  jobDescription: string,
  apiUrl: string,
  tabId: number,
): Promise<CoverLetterChoice> {
  const base = (apiUrl || (await getAcornApiUrl())).replace(/\/$/, "");
  const res = await fetch(`${base}/acorn/custom/cover-letter`, {
    method: "POST",
    headers: await authHeaders(tabId),
    body: JSON.stringify({ jobDescription }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    file?: RuntimeAttachedFile | null;
    stack?: string | null;
    reason?: string | null;
    error?: string;
    message?: string;
  };
  if (!res.ok) throw new Error(extractError(data, `Cover letter failed: ${res.status}`));
  const file = data.file?.base64 ? data.file : null;
  return { file, stack: data.stack ?? null, reason: data.reason ?? null };
}
