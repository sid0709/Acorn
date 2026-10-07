import { listParams } from "./query";
import type { GmailListQuery, GmailMessage, GmailOverview, GmailPage } from "./types";

/**
 * Browser reads of Gmail through app/api/gmail. Every read is cached in memory and
 * shared while in flight, so paging back, reopening a message, and prefetching the
 * next page or a hovered row never wait on Gmail twice.
 */

export type GmailFetch<T> = { ok: true; data: T } | { ok: false; message: string };

export const GMAIL_API = {
  messages: "/api/gmail/messages",
  overview: "/api/gmail/overview",
} as const;

const LIST_TTL_MS = 30_000;
const MESSAGE_TTL_MS = 10 * 60_000;
const MAX_CACHED = 400;

type Entry = { at: number; value: Promise<GmailFetch<unknown>> };
const cache = new Map<string, Entry>();

async function getJSON<T>(url: string): Promise<GmailFetch<T>> {
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    const body = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) return { ok: false, message: body.message || "Couldn’t read Gmail." };
    return { ok: true, data: body };
  } catch {
    return { ok: false, message: "Couldn’t reach Acorn. Check your connection." };
  }
}

function remember<T>(key: string, value: Promise<GmailFetch<T>>) {
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.delete(key);
  cache.set(key, { at: Date.now(), value });
  void value.then((result) => {
    if (!result.ok && cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

function cached<T>(
  key: string,
  ttl: number,
  load: () => Promise<GmailFetch<T>>,
  fresh: boolean,
): Promise<GmailFetch<T>> {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < ttl) return hit.value as Promise<GmailFetch<T>>;
  return remember(key, load());
}

export function listKey(query: GmailListQuery) {
  return [query.mailboxId, query.labelId, query.q, query.pageToken, query.pageSize].join("\u0000");
}

function listURL(query: GmailListQuery, fresh: boolean) {
  return `${GMAIL_API.messages}?${listParams(query, fresh)}`;
}

/** Ids Gmail reported unread, with their labels, so local reads can adjust counts. */
const unreadSeen = new Map<string, string[]>();

function noteRows(page: GmailPage) {
  for (const row of page.messages) {
    if (row.isUnread) unreadSeen.set(row.id, row.labelIds);
    else unreadSeen.delete(row.id);
  }
}

export function fetchPage(query: GmailListQuery, fresh = false) {
  const value = cached<GmailPage>(
    `page:${listKey(query)}`,
    LIST_TTL_MS,
    () => getJSON<GmailPage>(listURL(query, fresh)),
    fresh,
  );
  void value.then((result) => {
    if (result.ok) noteRows(result.data);
  });
  return value;
}

export function fetchOverview(mailboxId: string, fresh = false) {
  const params = new URLSearchParams({ mailboxId });
  if (fresh) params.set("fresh", "1");
  return cached<GmailOverview>(
    `overview:${mailboxId}`,
    LIST_TTL_MS,
    () => getJSON<GmailOverview>(`${GMAIL_API.overview}?${params}`),
    fresh,
  );
}

export function fetchMessage(mailboxId: string, id: string) {
  const params = new URLSearchParams({ mailboxId });
  return cached<GmailMessage>(
    `message:${mailboxId}:${id}`,
    MESSAGE_TTL_MS,
    async () => {
      const result = await getJSON<{ message: GmailMessage }>(
        `${GMAIL_API.messages}/${encodeURIComponent(id)}?${params}`,
      );
      return result.ok ? { ok: true, data: result.data.message } : result;
    },
    false,
  );
}

/** Warms the cache with data the server already rendered. */
export function seedPage(query: GmailListQuery, page: GmailPage) {
  noteRows(page);
  remember(`page:${listKey(query)}`, Promise.resolve({ ok: true, data: page }));
}

export function seedOverview(mailboxId: string, overview: GmailOverview) {
  remember(`overview:${mailboxId}`, Promise.resolve({ ok: true, data: overview }));
}

/**
 * Gmail's unread count for a label, less messages opened here that Gmail still
 * calls unread. Acorn reads Gmail read-only, so opening mail never reaches Gmail.
 */
export function unreadAfterLocalReads(labelId: string, gmailUnread: number, read: Set<string>) {
  let opened = 0;
  for (const [id, labelIds] of unreadSeen) {
    if (read.has(id) && labelIds.includes(labelId)) opened += 1;
  }
  return Math.max(0, gmailUnread - opened);
}
