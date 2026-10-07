import type { AutolabelOutcome, GmailRow, LabelGuide } from "./types";

/** Browser calls for label descriptions and one page of Autolabel. */

const GUIDES_API = "/api/gmail/label-guides";
const AUTOLABEL_API = "/api/gmail/autolabel";

type Call<T> = { ok: true; data: T } | { ok: false; message: string };

async function send<T>(url: string, init?: RequestInit): Promise<Call<T>> {
  try {
    const response = await fetch(url, { ...init, credentials: "same-origin" });
    const body = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) return { ok: false, message: body.message || "Couldn’t label mail." };
    return { ok: true, data: body };
  } catch {
    return { ok: false, message: "Couldn’t reach Acorn. Check your connection." };
  }
}

export function loadLabelGuides(mailboxId: string) {
  const params = new URLSearchParams({ mailboxId });
  return send<{ guides: LabelGuide[] }>(`${GUIDES_API}?${params}`);
}

export function saveLabelGuides(mailboxId: string, guides: LabelGuide[]) {
  return send<{ guides: LabelGuide[] }>(GUIDES_API, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mailboxId, guides }),
  });
}

export function autolabelMessages(mailboxId: string, rows: GmailRow[]) {
  return send<AutolabelOutcome>(AUTOLABEL_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mailboxId,
      messages: rows.map((row) => ({
        id: row.id,
        from: row.senderEmail ? `${row.sender} <${row.senderEmail}>` : row.sender,
        subject: row.subject,
        snippet: row.snippet,
      })),
    }),
  });
}

export function autolabelSummary(outcome: AutolabelOutcome): string {
  if (outcome.labeled === 0 && outcome.failed === 0) {
    return "None of the selected mail matched a label.";
  }
  const parts = [`Labeled ${outcome.labeled}`];
  if (outcome.unmatched > 0) parts.push(`${outcome.unmatched} matched no label`);
  if (outcome.failed > 0) parts.push(`${outcome.failed} could not be applied`);
  return `${parts.join(". ")}.`;
}
