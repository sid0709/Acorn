/**
 * Per-tab log of what the pipeline did on that page: the compressed tree, the meta
 * tree, the analysis, every backend call with its request and answer, the decisions
 * the run took and why, the plan, the steps. The service worker appends; the
 * sidebar's Logs tab reads. Every entry is kept whole: they live in the extension's
 * own IndexedDB (with unlimited storage), leave the machine only when the person
 * submits a support report, and go when the tab closes. Each tab keeps its last
 * LOG_KEEP_RUNS runs and at most LOG_TAB_MAX_CHARS of text, oldest runs first out.
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
  /** One backend call: what was sent, what came back, how long it took. */
  api: "api",
  /** A choice the run made (or refused to make) and the evidence for it. */
  decision: "decision",
  /** Something that failed and was caught: the run went on, the log says what. */
  error: "error",
  /** One file of an Agent Run's trace (a step, a model call, a screenshot): title is its name, text its content (an image as base64). */
  agentFile: "agent-file",
} as const;

export type LogKind = (typeof LOG_KIND)[keyof typeof LOG_KIND];

export const LOG_LEVEL = { info: "info", warn: "warn", error: "error" } as const;

export type LogLevel = (typeof LOG_LEVEL)[keyof typeof LOG_LEVEL];

/** What ties an entry to the rest of the story; all optional. */
export type LogMeta = {
  level?: LogLevel;
  /** The Run it belongs to; stamped from the tab's current run when the caller omits it. */
  runId?: string;
  /** The Run's step counter when it was written. */
  step?: number;
  /** The Run's page counter when it was written. */
  page?: number;
  /** How long the thing logged took, in milliseconds. */
  ms?: number;
  /** Entries that are one story (a call's request, answer, and the decision it led to) share a group. */
  group?: string;
};

export type TabLogEntry = LogMeta & {
  id: string;
  t: number;
  kind: LogKind;
  title: string;
  /** The code block: JSON for structured data, the tree text for trees. */
  text: string;
};

/** What a caller hands over; the store stamps `id` and `t`. */
export type TabLogInput = Pick<TabLogEntry, "kind" | "title" | "text"> & LogMeta;

/** What one write tells the sidebar: the entries a tab gained, or that its log was cleared. */
export type TabLogChange =
  | { tabId: number; added: TabLogEntry[] }
  | { tabId: number; cleared: true }
  /** A batch could not be written: how many entries were lost. */
  | { tabId: number; lost: number };

const DB_NAME = "acorn-tab-log";
const DB_VERSION = 1;
const ENTRY_STORE = "entries";
/** Entries by tab, in the order they were written (the store's own key). */
const BY_TAB = "byTab";
/** The channel the service worker announces each write on; the sidebar listens. */
const CHANGE_CHANNEL = "acorn-tab-log";
/** Entries wait this long to be written together, so a burst of step events is one write. */
const LOG_FLUSH_MS = 250;
/** A failed write is tried once more after this long before its entries are given up. */
const LOG_RETRY_MS = 500;
/** The runs a tab's log keeps; older runs' entries are dropped. */
const LOG_KEEP_RUNS = 5;
/** The most text a tab's log keeps, counted in characters; oldest runs first out. */
const LOG_TAB_MAX_CHARS = 50 * 1024 * 1024;
/** A tab's log is checked against those limits after this many written batches. */
const LOG_PRUNE_EVERY_BATCHES = 40;
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
const batchesSincePrune = new Map<number, number>();

/**
 * The Run in progress on each tab: every entry written for the tab while it runs
 * (the page's own traces, backend calls, the trees) is stamped with it, so the log
 * reads as one story per run.
 */
const runContexts = new Map<number, Pick<LogMeta, "runId" | "step" | "page">>();

/** Set (or, with null, end) the run whose entries a tab's log is stamping. */
export function setRunContext(
  tabId: number,
  context: Pick<LogMeta, "runId" | "step" | "page"> | null,
): void {
  if (context) runContexts.set(tabId, { ...runContexts.get(tabId), ...context });
  else runContexts.delete(tabId);
}

/** Tabs a run is on now, for entries that belong to no tab in particular. */
export function tabsWithRunContext(): number[] {
  return [...runContexts.keys()];
}

function built(entry: PendingEntry): TabLogEntry {
  return { ...entry, text: entry.text() };
}

async function writeBatch(tabId: number, added: TabLogEntry[]): Promise<void> {
  const db = await openDatabase();
  const write = db.transaction(ENTRY_STORE, "readwrite");
  const store = write.objectStore(ENTRY_STORE);
  for (const entry of added) store.add({ ...entry, tabId } satisfies StoredEntry);
  await done(write);
}

async function flushTab(tabId: number, queued: PendingEntry[]): Promise<void> {
  const added = queued.map(built);
  try {
    await writeBatch(tabId, added);
  } catch {
    // Once more, shortly after: a transient storage error should not cost the batch.
    await new Promise((resolve) => setTimeout(resolve, LOG_RETRY_MS));
    try {
      await writeBatch(tabId, added);
    } catch {
      // Never stops a run, but the sidebar is told entries were lost.
      announce({ tabId, lost: added.length });
      return;
    }
  }
  announce({ tabId, added });
  const batches = (batchesSincePrune.get(tabId) ?? 0) + 1;
  batchesSincePrune.set(tabId, batches);
  if (batches >= LOG_PRUNE_EVERY_BATCHES) {
    batchesSincePrune.set(tabId, 0);
    void pruneTabLog(tabId).catch(() => undefined);
  }
}

function flushAll(): Promise<unknown> {
  timer = null;
  const batches = [...pending];
  pending.clear();
  // Best effort: a failed write never stops a run.
  return Promise.all(
    batches.map(([tabId, added]) => flushTab(tabId, added).catch(() => undefined)),
  );
}

/** Write what is queued now (the service worker is about to be suspended, or a report is filed). */
export async function flushTabLogs(): Promise<void> {
  if (timer) clearTimeout(timer);
  await flushAll();
}

function queue(
  tabId: number,
  kind: LogKind,
  title: string,
  text: () => string,
  meta: LogMeta = {},
): void {
  const t = Date.now();
  sequence += 1;
  const context = runContexts.get(tabId);
  const entry: PendingEntry = {
    ...context,
    level: LOG_LEVEL.info,
    ...meta,
    kind,
    title,
    text,
    id: `${t}-${sequence}`,
    t,
  };
  pending.set(tabId, [...(pending.get(tabId) ?? []), entry]);
  timer ??= setTimeout(() => void flushAll(), LOG_FLUSH_MS);
}

/** Queue one entry for a tab's log. */
export function appendTabLog(tabId: number | undefined, input: TabLogInput): void {
  if (tabId == null) return;
  const { kind, title, text, ...meta } = input;
  queue(tabId, kind, title, () => text, meta);
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
  meta?: LogMeta,
): void {
  if (tabId == null) return;
  queue(
    tabId,
    kind,
    title,
    () => {
      try {
        return toLogText(build());
      } catch (err) {
        return `(could not render: ${String(err)})`;
      }
    },
    meta,
  );
}

/**
 * Keep a tab's log inside its limits: the last LOG_KEEP_RUNS runs, and at most
 * LOG_TAB_MAX_CHARS of text. Entries of no run (before the first one) are the oldest.
 */
export async function pruneTabLog(tabId: number): Promise<void> {
  const entries = await getTabLog(tabId);
  const doomed = entriesToPrune(entries, LOG_KEEP_RUNS, LOG_TAB_MAX_CHARS);
  if (!doomed.size) return;
  const db = await openDatabase();
  const write = db.transaction(ENTRY_STORE, "readwrite");
  const store = write.objectStore(ENTRY_STORE);
  const cursor = store.index(BY_TAB).openCursor(IDBKeyRange.only(tabId));
  cursor.onsuccess = () => {
    const at = cursor.result;
    if (!at) return;
    if (doomed.has((at.value as StoredEntry).id)) at.delete();
    at.continue();
  };
  await done(write);
  announce({ tabId, cleared: true });
  announce({ tabId, added: entries.filter((entry) => !doomed.has(entry.id)) });
}

/**
 * Which entries to drop: whole runs, oldest first, until at most `keepRuns` runs
 * remain and the rest fits `maxChars`. The newest run is never dropped.
 */
export function entriesToPrune(
  entries: readonly TabLogEntry[],
  keepRuns: number,
  maxChars: number,
): Set<string> {
  const runs: { id: string | undefined; ids: string[]; chars: number; last: number }[] = [];
  const byRun = new Map<string | undefined, (typeof runs)[number]>();
  for (const entry of entries) {
    let run = byRun.get(entry.runId);
    if (!run) {
      run = { id: entry.runId, ids: [], chars: 0, last: 0 };
      byRun.set(entry.runId, run);
      runs.push(run);
    }
    run.ids.push(entry.id);
    run.chars += entry.text.length + entry.title.length;
    run.last = Math.max(run.last, entry.t);
  }
  runs.sort((a, b) => a.last - b.last);
  const doomed = new Set<string>();
  let total = runs.reduce((sum, run) => sum + run.chars, 0);
  let kept = runs.length;
  for (const run of runs) {
    if (kept <= 1) break;
    if (kept <= keepRuns && total <= maxChars) break;
    for (const id of run.ids) doomed.add(id);
    total -= run.chars;
    kept -= 1;
  }
  return doomed;
}

export async function clearTabLog(tabId: number): Promise<void> {
  pending.delete(tabId);
  runContexts.delete(tabId);
  batchesSincePrune.delete(tabId);
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
  const context = runContexts.get(from);
  if (context) {
    runContexts.delete(from);
    runContexts.set(to, context);
  }
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
