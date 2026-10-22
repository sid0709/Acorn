/** Per-Chrome-tab key sent as X-Acorn-Tab. Must match acornapi tabHeader. */
export const TAB_KEY_HEADER = "X-Acorn-Tab";
/** Names the caller to the backend, as "<client>/<version>". Must match acornapi clientHeader. */
export const CLIENT_HEADER = "X-Acorn-Client";
const CLIENT_NAME = "oak";

export const TAB_KEYS_STORAGE_KEY = "oakTabKeys";

type KeyMap = Record<string, string>;

const pending = new Map<number, Promise<string>>();

async function readMap(): Promise<KeyMap> {
  const stored = await chrome.storage.session.get(TAB_KEYS_STORAGE_KEY);
  const raw = stored[TAB_KEYS_STORAGE_KEY];
  return raw && typeof raw === "object" ? { ...(raw as KeyMap) } : {};
}

async function readOrCreate(tabId: number): Promise<string> {
  const map = await readMap();
  const existing = map[String(tabId)];
  if (existing) return existing;
  const key = crypto.randomUUID();
  map[String(tabId)] = key;
  await chrome.storage.session.set({ [TAB_KEYS_STORAGE_KEY]: map });
  return key;
}

/** Stable id for this Chrome tab's AI usage. Survives panel reloads, not the browser. */
export function tabKeyFor(tabId: number): Promise<string> {
  const inflight = pending.get(tabId);
  if (inflight) return inflight;
  const created = readOrCreate(tabId).finally(() => {
    pending.delete(tabId);
  });
  pending.set(tabId, created);
  return created;
}

/** A replaced tab keeps the key (and so the cost) of the tab it replaced. */
export async function rekeyTabKey(fromTabId: number, toTabId: number): Promise<void> {
  if (fromTabId === toTabId) return;
  const map = await readMap();
  const key = map[String(fromTabId)];
  if (!key) return;
  delete map[String(fromTabId)];
  map[String(toTabId)] = key;
  await chrome.storage.session.set({ [TAB_KEYS_STORAGE_KEY]: map });
}

/** A closed tab's key is dropped; a new tab never reuses it. */
export async function forgetTabKey(tabId: number): Promise<void> {
  const map = await readMap();
  if (!(String(tabId) in map)) return;
  delete map[String(tabId)];
  await chrome.storage.session.set({ [TAB_KEYS_STORAGE_KEY]: map });
}

/** `oak/<manifest version>`. */
export function clientHeaderValue(): string {
  return `${CLIENT_NAME}/${chrome.runtime.getManifest().version}`;
}
