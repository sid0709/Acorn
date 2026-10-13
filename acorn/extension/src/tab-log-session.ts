import { withStorageLock } from "./storage-lock";

/**
 * Per-tab log of what the pipeline did on that page: the compressed tree, the meta
 * tree, the analysis, the model request and response, the plan, the steps. The
 * service worker appends; the sidebar's Logs tab reads. It lives in session storage,
 * so it ends with the browser session and never leaves the machine.
 */

export const TAB_LOG_STORAGE_PREFIX = "acornTabLog:";

export const LOG_KIND = {
  dom: "dom",
  pureTree: "pure-tree",
  metaTree: "meta-tree",
  analysis: "analysis",
  aiRequest: "ai-request",
  aiResponse: "ai-response",
  plan: "plan",
  event: "event",
} as const;

export type LogKind = (typeof LOG_KIND)[keyof typeof LOG_KIND];

export type TabLogEntry = {
  id: string;
  t: number;
  kind: LogKind;
  title: string;
  /** The code block: JSON for structured data, the tree text for trees. */
  text: string;
};

/** What a caller hands over; the store stamps `id` and `t`. */
export type TabLogInput = Pick<TabLogEntry, "kind" | "title" | "text">;

/** One entry's text is cut here, so a huge page tree cannot fill the storage quota alone. */
export const LOG_ENTRY_MAX_CHARS = 150_000;
/** Text kept per tab; the oldest entries go first. Session storage holds 10 MB across all tabs. */
export const LOG_TAB_MAX_CHARS = 1_200_000;
/** Entries kept per tab. */
export const LOG_TAB_MAX_ENTRIES = 300;
/** Entries wait this long to be written together, so a burst of step events is one write. */
const LOG_FLUSH_MS = 250;

export function tabLogKey(tabId: number): string {
  return `${TAB_LOG_STORAGE_PREFIX}${tabId}`;
}

export function tabIdFromLogKey(key: string): number | null {
  if (!key.startsWith(TAB_LOG_STORAGE_PREFIX)) return null;
  const id = Number(key.slice(TAB_LOG_STORAGE_PREFIX.length));
  return Number.isInteger(id) ? id : null;
}

/** Text as JSON for the code block; values that cannot be stringified are named instead. */
export function toLogText(data: unknown): string {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data, null, 2) ?? "";
  } catch (err) {
    return `(could not render: ${String(err)})`;
  }
}

function clip(text: string): string {
  if (text.length <= LOG_ENTRY_MAX_CHARS) return text;
  return `${text.slice(0, LOG_ENTRY_MAX_CHARS)}\n… cut, ${text.length - LOG_ENTRY_MAX_CHARS} more characters`;
}

function trim(entries: TabLogEntry[]): TabLogEntry[] {
  let kept = entries.slice(-LOG_TAB_MAX_ENTRIES);
  let size = kept.reduce((sum, entry) => sum + entry.text.length, 0);
  while (kept.length > 1 && size > LOG_TAB_MAX_CHARS) {
    size -= kept[0].text.length;
    kept = kept.slice(1);
  }
  return kept;
}

export async function getTabLog(tabId: number): Promise<TabLogEntry[]> {
  const key = tabLogKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const raw = stored[key];
  return Array.isArray(raw) ? (raw as TabLogEntry[]) : [];
}

const pending = new Map<number, TabLogEntry[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
let sequence = 0;

async function flushTab(tabId: number, added: TabLogEntry[]): Promise<void> {
  const key = tabLogKey(tabId);
  await withStorageLock(key, async () => {
    const next = trim([...(await getTabLog(tabId)), ...added]);
    await chrome.storage.session.set({ [key]: next });
  });
}

function flushAll(): void {
  timer = null;
  const batches = [...pending];
  pending.clear();
  for (const [tabId, added] of batches) {
    // Best effort: a failed write drops this batch and never stops a run.
    void flushTab(tabId, added).catch(() => undefined);
  }
}

/** Queue one entry for a tab's log. */
export function appendTabLog(tabId: number | undefined, input: TabLogInput): void {
  if (tabId == null) return;
  const t = Date.now();
  sequence += 1;
  const entry: TabLogEntry = { ...input, text: clip(input.text), id: `${t}-${sequence}`, t };
  pending.set(tabId, [...(pending.get(tabId) ?? []), entry]);
  timer ??= setTimeout(flushAll, LOG_FLUSH_MS);
}

/** Lazy form of {@link appendTabLog}: `build` runs once, and a throw is kept out of the run. */
export function logTab(
  tabId: number | undefined,
  kind: LogKind,
  title: string,
  build: () => unknown,
): void {
  if (tabId == null) return;
  try {
    appendTabLog(tabId, { kind, title, text: toLogText(build()) });
  } catch {
    /* logging never stops a run */
  }
}

export async function clearTabLog(tabId: number): Promise<void> {
  pending.delete(tabId);
  const key = tabLogKey(tabId);
  await withStorageLock(key, () => chrome.storage.session.remove(key));
}
