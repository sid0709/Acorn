/**
 * Per-tab log of what the pipeline did on that page: the compressed tree, the meta
 * tree, the analysis, the model request and response, the plan, the steps. The
 * service worker appends; the sidebar's Logs tab reads. Every entry is kept whole,
 * with no cap on their number or size: they live in the extension's own IndexedDB
 * (with unlimited storage), never leave the machine, and go when the tab closes.
 */

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

/** What one write tells the sidebar: the entries a tab gained, or that its log was cleared. */
export type TabLogChange =
  { tabId: number; added: TabLogEntry[] } | { tabId: number; cleared: true };

const DB_NAME = "acorn-tab-log";
const DB_VERSION = 1;
const ENTRY_STORE = "entries";
/** Entries by tab, in the order they were written (the store's own key). */
const BY_TAB = "byTab";
/** The channel the service worker announces each write on; the sidebar listens. */
const CHANGE_CHANNEL = "acorn-tab-log";
/** Entries wait this long to be written together, so a burst of step events is one write. */
const LOG_FLUSH_MS = 250;
/** Where the log lived before (session storage): its leftovers are removed once. */
const LEGACY_SESSION_PREFIX = "acornTabLog:";

type StoredEntry = TabLogEntry & { tabId: number };

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(ENTRY_STORE, { autoIncrement: true });
      store.createIndex(BY_TAB, "tabId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = null;
      reject(request.error ?? new Error("Could not open the log database"));
    };
  });
  return database;
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error("Log write failed"));
  });
}

function announce(change: TabLogChange): void {
  const channel = new BroadcastChannel(CHANGE_CHANNEL);
  channel.postMessage(change);
  channel.close();
}

/** Follow every tab's log changes; returns the function that stops following. */
export function onTabLogChange(listener: (change: TabLogChange) => void): () => void {
  const channel = new BroadcastChannel(CHANGE_CHANNEL);
  channel.onmessage = (event: MessageEvent<TabLogChange>) => listener(event.data);
  return () => channel.close();
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

export async function getTabLog(tabId: number): Promise<TabLogEntry[]> {
  const db = await openDatabase();
  const read = db.transaction(ENTRY_STORE, "readonly");
  const request = read.objectStore(ENTRY_STORE).index(BY_TAB).getAll(IDBKeyRange.only(tabId));
  await done(read);
  return (request.result as StoredEntry[]).map(({ tabId: _tab, ...entry }) => entry);
}

/**
 * An entry waiting to be written. Its text is built when the batch is written, not
 * when it is logged: building a big entry (a tree, a plan) never holds up the step
 * that logged it.
 */
type PendingEntry = Omit<TabLogEntry, "text"> & { text: () => string };

const pending = new Map<number, PendingEntry[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
let sequence = 0;

function built(entry: PendingEntry): TabLogEntry {
  return { ...entry, text: entry.text() };
}

async function flushTab(tabId: number, queued: PendingEntry[]): Promise<void> {
  const added = queued.map(built);
  const db = await openDatabase();
  const write = db.transaction(ENTRY_STORE, "readwrite");
  const store = write.objectStore(ENTRY_STORE);
  for (const entry of added) store.add({ ...entry, tabId } satisfies StoredEntry);
  await done(write);
  announce({ tabId, added });
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

function queue(tabId: number, kind: LogKind, title: string, text: () => string): void {
  const t = Date.now();
  sequence += 1;
  const entry: PendingEntry = { kind, title, text, id: `${t}-${sequence}`, t };
  pending.set(tabId, [...(pending.get(tabId) ?? []), entry]);
  timer ??= setTimeout(flushAll, LOG_FLUSH_MS);
}

/** Queue one entry for a tab's log. */
export function appendTabLog(tabId: number | undefined, input: TabLogInput): void {
  if (tabId == null) return;
  queue(tabId, input.kind, input.title, () => input.text);
}

/**
 * Lazy form of {@link appendTabLog}: `build` runs once, when the batch is written
 * (after the step that logged it went on), and a throw is kept out of the run.
 */
export function logTab(
  tabId: number | undefined,
  kind: LogKind,
  title: string,
  build: () => unknown,
): void {
  if (tabId == null) return;
  queue(tabId, kind, title, () => {
    try {
      return toLogText(build());
    } catch (err) {
      return `(could not render: ${String(err)})`;
    }
  });
}

export async function clearTabLog(tabId: number): Promise<void> {
  pending.delete(tabId);
  const db = await openDatabase();
  const write = db.transaction(ENTRY_STORE, "readwrite");
  const index = write.objectStore(ENTRY_STORE).index(BY_TAB);
  const cursor = index.openKeyCursor(IDBKeyRange.only(tabId));
  cursor.onsuccess = () => {
    const at = cursor.result;
    if (!at) return;
    write.objectStore(ENTRY_STORE).delete(at.primaryKey);
    at.continue();
  };
  await done(write);
  announce({ tabId, cleared: true });
}

/**
 * A run that moved to another tab (an Apply that opened one, a tab Chrome swapped)
 * takes its log along: the tab it left can close without losing what came before.
 * Entries keep their order; the moved ones come first.
 */
export async function moveTabLog(from: number, to: number): Promise<void> {
  if (from === to) return;
  const queued = pending.get(from);
  if (queued) {
    pending.delete(from);
    pending.set(to, [...queued, ...(pending.get(to) ?? [])]);
  }
  const db = await openDatabase();
  const write = db.transaction(ENTRY_STORE, "readwrite");
  const moved: TabLogEntry[] = [];
  const cursor = write.objectStore(ENTRY_STORE).index(BY_TAB).openCursor(IDBKeyRange.only(from));
  cursor.onsuccess = () => {
    const at = cursor.result;
    if (!at) return;
    const stored = at.value as StoredEntry;
    const { tabId: _from, ...entry } = stored;
    moved.push(entry);
    at.update({ ...stored, tabId: to } satisfies StoredEntry);
    at.continue();
  };
  await done(write);
  announce({ tabId: from, cleared: true });
  if (moved.length) announce({ tabId: to, added: moved });
}

/**
 * Logs of tabs that no longer exist (the browser closed with them open): a new
 * session starts without them, as the session-storage log did.
 */
export async function dropClosedTabLogs(openTabIds: number[]): Promise<void> {
  const open = new Set(openTabIds);
  const db = await openDatabase();
  const write = db.transaction(ENTRY_STORE, "readwrite");
  const cursor = write.objectStore(ENTRY_STORE).openCursor();
  cursor.onsuccess = () => {
    const at = cursor.result;
    if (!at) return;
    if (!open.has((at.value as StoredEntry).tabId)) at.delete();
    at.continue();
  };
  await done(write);
}

/** The log's old home in session storage held a quota-bound copy: free it. */
export async function dropLegacySessionLogs(): Promise<void> {
  const stored = await chrome.storage.session.get(null);
  const keys = Object.keys(stored).filter((key) => key.startsWith(LEGACY_SESSION_PREFIX));
  if (keys.length) await chrome.storage.session.remove(keys);
}
