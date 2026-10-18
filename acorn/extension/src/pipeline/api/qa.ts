import { authHeaders, getAcornApiUrl } from "../../auth/acorn-auth";

import { loggedFetch } from "./api-log";

export type AcornQaPage = {
  title?: string;
  url?: string;
};

export async function requestQaAnswer(
  input: { question: string; page?: AcornQaPage | null },
  _apiUrl?: string,
  tabId?: number | null,
): Promise<string> {
  const question = input.question.trim();
  if (!question) throw new Error("Enter a question");
  const base = (_apiUrl || (await getAcornApiUrl())).replace(/\/$/, "");
  const res = await loggedFetch(tabId, "qa", `${base}/acorn/qa`, {
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
