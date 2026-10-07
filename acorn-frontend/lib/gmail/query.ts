import type { GmailListQuery } from "./types";

/** The query string acorn-backend's message list reads. Shared by server and browser. */
export function listParams(query: GmailListQuery, fresh = false) {
  const params = new URLSearchParams({
    mailboxId: query.mailboxId,
    pageSize: String(query.pageSize),
  });
  if (query.labelId) params.set("labelId", query.labelId);
  if (query.q) params.set("q", query.q);
  if (query.pageToken) params.set("pageToken", query.pageToken);
  if (fresh) params.set("fresh", "1");
  return params;
}
