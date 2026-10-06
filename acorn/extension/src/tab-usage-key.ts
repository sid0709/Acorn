/** Per-Chrome-tab key sent as X-Acorn-Tab. Must match acornapi tabHeader. */
export const ACORN_TAB_HEADER = "X-Acorn-Tab";

const TAB_USAGE_KEYS = "acornTabUsageKeys";

type KeyMap = Record<string, string>;

const pending = new Map<number, Promise<string>>();

async function readMap(): Promise<KeyMap> {
  const stored = await chrome.storage.session.get(TAB_USAGE_KEYS);
  const raw = stored[TAB_USAGE_KEYS];
  return raw && typeof raw === "object" ? { ...(raw as KeyMap) } : {};
}

async function readOrCreate(tabId: number): Promise<string> {
  const map = await readMap();
  const existing = map[String(tabId)];
  if (existing) return existing;
  const key = crypto.randomUUID();
  map[String(tabId)] = key;
  await chrome.storage.session.set({ [TAB_USAGE_KEYS]: map });
  return key;
}

/** Stable id for this Chrome tab's AI usage. Survives sidebar reloads, not the browser. */
export function usageTabKey(tabId: number): Promise<string> {
  const inflight = pending.get(tabId);
  if (inflight) return inflight;
  const created = readOrCreate(tabId).finally(() => {
    pending.delete(tabId);
  });
  pending.set(tabId, created);
  return created;
}

/** A replaced tab keeps the usage history of the tab it replaced. */
export async function rekeyUsageTab(fromTabId: number, toTabId: number): Promise<void> {
  if (fromTabId === toTabId) return;
  const map = await readMap();
  const key = map[String(fromTabId)];
  if (!key) return;
  delete map[String(fromTabId)];
  map[String(toTabId)] = key;
  await chrome.storage.session.set({ [TAB_USAGE_KEYS]: map });
}
