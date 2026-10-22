import type { AiUsageSummary } from "../../../shared/ai-usage";
import type { ActionPlan, RuntimeAttachedFile } from "../../../shared/plan-runner/types";
import { authHeaders, getAthensApiUrl } from "../auth/oak-auth";

export interface AiAnalyzePage {
  title?: string;
  url?: string;
  fetchedAt?: string;
  recommendedResumeAvailable?: boolean;
  recommendedResumeStack?: string | null;
}

export interface AiAnalyzeRequest {
  /** Sole tree the planner reads; control attrs ride on each node's `detail`. */
  pureTree: string;
  page?: AiAnalyzePage | null;
}

export interface AiAnalyzeResponse {
  ok?: boolean;
  plan?: ActionPlan;
  model?: string;
  responseId?: string | null;
  error?: string;
  usage?: AiUsageSummary;
}

async function apiBase(apiUrl?: string): Promise<string> {
  return (apiUrl || (await getAthensApiUrl())).replace(/\/$/, "");
}

/** `tabId` files the call's cost under that Chrome tab's key. */
export async function requestAiAnalyze(
  payload: AiAnalyzeRequest,
  apiUrl?: string,
  tabId?: number | null,
): Promise<AiAnalyzeResponse> {
  const base = await apiBase(apiUrl);
  const res = await fetch(`${base}/api/oak/ai-analyze`, {
    method: "POST",
    headers: await authHeaders(tabId),
    body: JSON.stringify(payload),
  });

  const data = (await res.json().catch(() => ({}))) as AiAnalyzeResponse & {
    message?: string;
    success?: boolean;
  };
  if (!res.ok) {
    throw new Error(extractError(data, `AI analyze failed: ${res.status}`));
  }
  if (!data.plan) {
    throw new Error(extractError(data, "AI backend returned no plan"));
  }
  return data;
}

const GENERIC_HTTP_ERRORS = new Set([
  "Bad Request",
  "Unauthorized",
  "Forbidden",
  "Not Found",
  "Internal Server Error",
]);

export function extractError(
  data: { error?: unknown; message?: unknown },
  fallback: string,
): string {
  const nested =
    data.message && typeof data.message === "object"
      ? (data.message as { error?: unknown; message?: unknown })
      : null;
  for (const candidate of [data.error, nested?.error, data.message, nested?.message]) {
    if (typeof candidate === "string" && candidate.trim()) {
      const text = candidate.trim();
      if (!GENERIC_HTTP_ERRORS.has(text) && !/^Cannot (GET|POST|PUT|PATCH|DELETE)\b/i.test(text)) {
        return text;
      }
    }
  }
  return fallback;
}

function readId(value: unknown): string | null {
  const text = String(value || "").trim();
  return text || null;
}

function isMissingRoute(status: number, data: { message?: unknown }): boolean {
  if (status !== 404) return false;
  const message = typeof data.message === "string" ? data.message : "";
  return /^Cannot (GET|POST|PUT|PATCH|DELETE)\b/i.test(message);
}

const LIBRARY_FILE_UNAVAILABLE = "Could not load the Library résumé.";

/** The account's primary Library résumé. */
export async function fetchRuntimeFile(apiUrl?: string): Promise<RuntimeAttachedFile | null> {
  const base = await apiBase(apiUrl);
  const res = await fetch(`${base}/api/oak/runtime-file`, {
    headers: await authHeaders(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    file?: RuntimeAttachedFile;
    error?: string;
  };
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(
      typeof data.error === "string" ? data.error : `Runtime file failed: ${res.status}`,
    );
  }
  return data.file ?? null;
}

export async function requestQaAnswer(
  input: { question: string; page?: OakQaPage | null },
  apiUrl?: string,
  tabId?: number | null,
): Promise<string> {
  const question = input.question.trim();
  if (!question) throw new Error("Enter a question");
  const base = await apiBase(apiUrl);
  const res = await fetch(`${base}/api/oak/qa`, {
    method: "POST",
    headers: await authHeaders(tabId),
    body: JSON.stringify({
      question,
      page: input.page ?? null,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    answer?: string;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : typeof data.message === "string"
          ? data.message
          : `Q&A failed: ${res.status}`,
    );
  }
  const answer = typeof data.answer === "string" ? data.answer.trim() : "";
  if (!answer) throw new Error("Writer returned no answer");
  return answer;
}

export type OakQaPage = {
  title?: string;
  url?: string;
};

/** A Library résumé by id, in the shape Fill uploads. */
export async function fetchLibraryResume(
  resumeId: string,
  apiUrl?: string,
): Promise<RuntimeAttachedFile | null> {
  const id = String(resumeId || "").trim();
  if (!id) return null;
  const base = await apiBase(apiUrl);
  const res = await fetch(`${base}/api/oak/custom/library-resumes/${encodeURIComponent(id)}`, {
    headers: await authHeaders(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    file?: RuntimeAttachedFile;
    resumeId?: string | null;
    stack?: string | null;
    error?: string;
    message?: string;
  };
  if (isMissingRoute(res.status, data)) {
    throw new Error(LIBRARY_FILE_UNAVAILABLE);
  }
  if (!res.ok) {
    throw new Error(extractError(data, `Resume file failed: ${res.status}`));
  }
  const responseId = readId(data.resumeId);
  if (responseId && responseId !== id) {
    throw new Error("Library résumé belongs to a different pick");
  }
  const file = data.file;
  if (!file?.base64 || !String(file.name || "").trim()) return null;
  const stack = String(data.stack || file.label || "").trim();
  return {
    ...file,
    key: file.key || "recommended_resume",
    resumeId: responseId || id,
    label: stack || file.name,
  };
}

export type JdShotTop = { resumeId: string; stack: string; probability: number };

export type JdShotResult = {
  hasJobDescription: boolean;
  /** Why the page was not read as a posting. */
  reason: string | null;
  resumeId: string | null;
  stack: string | null;
  matchReason: string | null;
  top: JdShotTop[];
};

/**
 * Sends the page's pure tree. The backend has Jev check it is a job posting and, if so, pick the
 * Library résumé that fits.
 */
export async function requestJdShot(
  input: { pageText: string },
  apiUrl?: string,
  tabId?: number | null,
): Promise<JdShotResult> {
  const pageText = input.pageText.trim();
  if (!pageText) throw new Error("No readable text on this tab");
  const base = await apiBase(apiUrl);
  const res = await fetch(`${base}/api/oak/jd-shot`, {
    method: "POST",
    headers: await authHeaders(tabId),
    body: JSON.stringify({ pageText }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    hasJobDescription?: unknown;
    reason?: unknown;
    resumeId?: unknown;
    stack?: unknown;
    matchReason?: unknown;
    top?: unknown;
    error?: string;
    message?: string;
  };
  if (isMissingRoute(res.status, data)) {
    throw new Error("This Oak backend has no JD shot yet.");
  }
  if (!res.ok) {
    throw new Error(extractError(data, `JD shot failed: ${res.status}`));
  }
  const top = Array.isArray(data.top)
    ? data.top.flatMap((row): JdShotTop[] => {
        const item = row as { resumeId?: unknown; stack?: unknown; probability?: unknown };
        const resumeId = readId(item.resumeId);
        if (!resumeId) return [];
        return [
          {
            resumeId,
            stack: String(item.stack || "").trim(),
            probability: typeof item.probability === "number" ? item.probability : 0,
          },
        ];
      })
    : [];
  return {
    hasJobDescription: Boolean(data.hasJobDescription),
    reason: String(data.reason || "").trim() || null,
    resumeId: readId(data.resumeId),
    stack: String(data.stack || "").trim() || null,
    matchReason: String(data.matchReason || "").trim() || null,
    top,
  };
}

export type TabCost = { costNanos: number; calls: number };

/** What the models cost one Chrome tab so far; the backend sums the tab's usage rows. */
export async function fetchTabCost(tabId: number, apiUrl?: string): Promise<TabCost> {
  const base = await apiBase(apiUrl);
  const res = await fetch(`${base}/api/oak/tab-cost`, {
    headers: await authHeaders(tabId),
  });
  const data = (await res.json().catch(() => ({}))) as {
    costNanos?: unknown;
    calls?: unknown;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(extractError(data, `Cost failed: ${res.status}`));
  }
  const costNanos = Number(data.costNanos);
  const calls = Number(data.calls);
  return {
    costNanos: Number.isFinite(costNanos) ? costNanos : 0,
    calls: Number.isFinite(calls) ? calls : 0,
  };
}

export type SentInput = {
  url: string;
  title: string;
  durationMs: number;
  steps: number;
  endedAt: number;
  /** Minutes east of UTC on the person's clock at `endedAt`. */
  utcOffsetMinutes: number;
  /** Full-page JPEG, base64 without a `data:` prefix. */
  screenshot: string;
};

export type SentResult = { recorded: boolean; runId: string | null };

/** Counts the page as sent on the dashboard, with the full-page screenshot. */
export async function requestSent(
  input: SentInput,
  apiUrl?: string,
  tabId?: number | null,
): Promise<SentResult> {
  const base = await apiBase(apiUrl);
  const res = await fetch(`${base}/api/oak/sent`, {
    method: "POST",
    headers: await authHeaders(tabId),
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    recorded?: unknown;
    runId?: unknown;
    error?: string;
    message?: string;
  };
  if (isMissingRoute(res.status, data)) {
    throw new Error("This Oak backend cannot record sent pages yet.");
  }
  if (!res.ok || data.success === false) {
    throw new Error(extractError(data, `Sent failed: ${res.status}`));
  }
  return { recorded: Boolean(data.recorded), runId: readId(data.runId) };
}

/** One verification email in the Emails list. */
export type OakEmailRow = {
  mailboxId: string;
  mailboxEmail: string;
  id: string;
  from: string;
  subject: string;
  snippet: string;
  /** ms since epoch. */
  receivedAt: number;
  unread: boolean;
};

export type OakEmailAttachment = { filename: string; mimeType: string; size: number };

/** One verification email in full. `html` has its inline images folded in as data URLs. */
export type OakEmailMessage = {
  mailboxId: string;
  id: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  /** ms since epoch. */
  date: number;
  html: string;
  text: string;
  attachments: OakEmailAttachment[];
};

async function getEmailJson<T>(path: string, fallback: string): Promise<T> {
  const base = await apiBase();
  const res = await fetch(`${base}${path}`, { headers: await authHeaders() });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: unknown;
    message?: unknown;
  };
  if (!res.ok) throw new Error(extractError(data, `${fallback} (${res.status})`));
  return data;
}

/** The emails the Gmail watcher labelled `oak-verify-email`, newest first. */
export async function fetchEmails(): Promise<OakEmailRow[]> {
  const data = await getEmailJson<{ messages?: OakEmailRow[] }>(
    "/api/oak/emails",
    "Could not load the emails",
  );
  return Array.isArray(data.messages) ? data.messages : [];
}

/** One labelled email in full, read live from Gmail. */
export async function fetchEmail(mailboxId: string, id: string): Promise<OakEmailMessage> {
  const data = await getEmailJson<{ message?: OakEmailMessage }>(
    `/api/oak/emails/${encodeURIComponent(mailboxId)}/${encodeURIComponent(id)}`,
    "Could not load the email",
  );
  if (!data.message) throw new Error("The email came back empty");
  return data.message;
}
