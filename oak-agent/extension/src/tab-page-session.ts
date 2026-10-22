/** JD shot state of one page: idle, reading and matching, a posting was found, none on the page, or an error. */
export type JdShotStatus = "idle" | "running" | "found" | "none" | "failed";

/** A remembered Chrome tab: one job page Oak fills, matches a résumé to, and counts as sent. */
export type OakPageBinding = {
  tabId: number;
  url: string;
  title: string;
  favIconUrl: string | null;
  rememberedAt: string;
  /** Library résumé the last JD shot picked; Fill uploads it. Empty until a JD shot finds a posting. */
  resumeId: string | null;
  resumeStack: string | null;
  resumeReason: string | null;
  jdStatus: JdShotStatus;
  /** Why the last JD shot found nothing or failed. */
  jdMessage: string | null;
  /** Time the Fill pipeline and JD shots ran on this page (ms), not the time it sat idle. */
  workMs: number;
  /** Plan steps Fill ran on this page. */
  steps: number;
  /** What the models cost this page, from the backend (nanodollars); null until first read. */
  costNanos: number | null;
  costCalls: number;
};

export const TAB_PAGES_STORAGE_KEY = "oakPages";

export type PageMap = Record<string, OakPageBinding>;

function normalizeBinding(row: OakPageBinding): OakPageBinding {
  return {
    ...row,
    favIconUrl: row.favIconUrl ?? null,
    resumeId: row.resumeId ?? null,
    resumeStack: row.resumeStack ?? null,
    resumeReason: row.resumeReason ?? null,
    jdStatus: row.jdStatus ?? "idle",
    jdMessage: row.jdMessage ?? null,
    workMs: row.workMs ?? 0,
    steps: row.steps ?? 0,
    costNanos: row.costNanos ?? null,
    costCalls: row.costCalls ?? 0,
  };
}

export function pageHasResume(page: OakPageBinding): boolean {
  return Boolean(String(page.resumeId || "").trim());
}

async function readMap(): Promise<PageMap> {
  const stored = await chrome.storage.session.get(TAB_PAGES_STORAGE_KEY);
  const raw = stored[TAB_PAGES_STORAGE_KEY];
  if (!raw || typeof raw !== "object") return {};
  const map: PageMap = {};
  for (const [key, row] of Object.entries(raw as PageMap)) {
    if (row && typeof row === "object") map[key] = normalizeBinding(row);
  }
  return map;
}

async function writeMap(map: PageMap): Promise<void> {
  await chrome.storage.session.set({ [TAB_PAGES_STORAGE_KEY]: map });
}

/** Writes read-modify-write the whole map, so they run one at a time. */
let writeTail: Promise<unknown> = Promise.resolve();

function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const run = writeTail.then(work, work);
  writeTail = run.catch(() => undefined);
  return run;
}

export async function listPages(): Promise<PageMap> {
  return readMap();
}

export async function getPage(tabId: number): Promise<OakPageBinding | null> {
  const map = await readMap();
  return map[String(tabId)] ?? null;
}

export function rememberPage(input: {
  tabId: number;
  url: string;
  title: string;
  favIconUrl?: string | null;
}): Promise<OakPageBinding> {
  return exclusive(async () => {
    const map = await readMap();
    const key = String(input.tabId);
    const existing = map[key];
    const favIconUrl = input.favIconUrl?.trim() || existing?.favIconUrl || null;
    const next: OakPageBinding = existing
      ? {
          ...existing,
          url: input.url || existing.url,
          title: input.title || existing.title,
          favIconUrl,
        }
      : {
          tabId: input.tabId,
          url: input.url,
          title: input.title,
          favIconUrl,
          rememberedAt: new Date().toISOString(),
          resumeId: null,
          resumeStack: null,
          resumeReason: null,
          jdStatus: "idle",
          jdMessage: null,
          workMs: 0,
          steps: 0,
          costNanos: null,
          costCalls: 0,
        };
    map[key] = next;
    await writeMap(map);
    return next;
  });
}

export function patchPage(
  tabId: number,
  patch: Partial<Omit<OakPageBinding, "tabId">>,
): Promise<OakPageBinding | null> {
  return exclusive(async () => {
    const map = await readMap();
    const key = String(tabId);
    const existing = map[key];
    if (!existing) return null;
    const next = normalizeBinding({ ...existing, ...patch, tabId });
    map[key] = next;
    await writeMap(map);
    return next;
  });
}

/** Adds work to the totals the Sent record carries. */
export function addPageWork(
  tabId: number,
  work: { durationMs?: number; steps?: number },
): Promise<void> {
  return exclusive(async () => {
    const map = await readMap();
    const key = String(tabId);
    const existing = map[key];
    if (!existing) return;
    map[key] = {
      ...existing,
      workMs: existing.workMs + Math.max(0, Math.round(work.durationMs ?? 0)),
      steps: existing.steps + Math.max(0, Math.round(work.steps ?? 0)),
    };
    await writeMap(map);
  });
}

export function refreshPageMeta(
  tabId: number,
  meta: { url?: string; title?: string; favIconUrl?: string | null },
): Promise<void> {
  return exclusive(async () => {
    const map = await readMap();
    const key = String(tabId);
    const existing = map[key];
    if (!existing) return;
    const url = typeof meta.url === "string" && meta.url.trim() ? meta.url : existing.url;
    const title = typeof meta.title === "string" && meta.title.trim() ? meta.title : existing.title;
    const favIconUrl =
      typeof meta.favIconUrl === "string" && meta.favIconUrl.trim()
        ? meta.favIconUrl.trim()
        : existing.favIconUrl;
    if (url === existing.url && title === existing.title && favIconUrl === existing.favIconUrl) {
      return;
    }
    map[key] = { ...existing, url, title, favIconUrl };
    await writeMap(map);
  });
}

/**
 * A JD shot that was running when the service worker stopped never finishes. On start-up nothing
 * is in flight, so any "running" status is stale and would keep the page's buttons off.
 */
export function resetInterruptedJdShots(): Promise<void> {
  return exclusive(async () => {
    const map = await readMap();
    let changed = false;
    for (const row of Object.values(map)) {
      if (row.jdStatus !== "running") continue;
      row.jdStatus = "failed";
      row.jdMessage = "The JD shot was interrupted. Try again.";
      changed = true;
    }
    if (changed) await writeMap(map);
  });
}

export function unbindPage(tabId: number): Promise<void> {
  return exclusive(async () => {
    const map = await readMap();
    if (!(String(tabId) in map)) return;
    delete map[String(tabId)];
    await writeMap(map);
  });
}

export function rekeyPage(fromTabId: number, toTabId: number): Promise<void> {
  return exclusive(async () => {
    if (fromTabId === toTabId) return;
    const map = await readMap();
    const fromKey = String(fromTabId);
    const row = map[fromKey];
    if (!row) return;
    delete map[fromKey];
    map[String(toTabId)] = { ...row, tabId: toTabId };
    await writeMap(map);
  });
}
