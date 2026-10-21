/**
 * The pictures the model last saw on each tab, made small for the Now card's filmstrip, each with the part of
 * the page it shows (CSS pixels). They stay in this browser's session storage under one key per tab, so a
 * run's write does not rewrite the other tabs', and go when the tab closes. Nothing here leaves the browser.
 */

/** The session-storage key of a tab's pictures is this and the tab's id. */
export const TAB_RUN_SHOTS_KEY_PREFIX = "acornRunShots:";

export function tabRunShotsKey(tabId: number): string {
  return `${TAB_RUN_SHOTS_KEY_PREFIX}${tabId}`;
}

/** One picture the model saw: a JPEG data URL, and the part of the page it shows (CSS pixels). */
export interface RunShot {
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Taken for an earlier look and sent again, not photographed for this one. */
  reused: boolean;
}

/** The pictures of the last look of a run on a tab. */
export interface TabRunShots {
  runId: string;
  /** When they were saved (ms since epoch). */
  at: number;
  shots: RunShot[];
}

function isShot(value: unknown): value is RunShot {
  if (!value || typeof value !== "object") return false;
  const shot = value as Partial<RunShot>;
  return (
    typeof shot.src === "string" &&
    shot.src.startsWith("data:image/") &&
    [shot.left, shot.top, shot.width, shot.height].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    ) &&
    typeof shot.reused === "boolean"
  );
}

/** What a key holds, as pictures the filmstrip can show; null when it holds none or another shape. */
export function runShotsFromStored(value: unknown): TabRunShots | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as Partial<TabRunShots>;
  if (typeof stored.runId !== "string" || typeof stored.at !== "number") return null;
  if (!Array.isArray(stored.shots) || !stored.shots.every(isShot)) return null;
  return { runId: stored.runId, at: stored.at, shots: stored.shots };
}

export async function saveTabRunShots(tabId: number, shots: TabRunShots): Promise<void> {
  await chrome.storage.session.set({ [tabRunShotsKey(tabId)]: shots });
}

export async function readTabRunShots(tabId: number): Promise<TabRunShots | null> {
  const key = tabRunShotsKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return runShotsFromStored(stored[key]);
}

export async function clearTabRunShots(tabId: number): Promise<void> {
  await chrome.storage.session.remove(tabRunShotsKey(tabId));
}

/** A tab replaced by another (a prerendered page swapped in): its pictures follow it. */
export async function rekeyTabRunShots(fromTabId: number, toTabId: number): Promise<void> {
  if (fromTabId === toTabId) return;
  const shots = await readTabRunShots(fromTabId);
  await clearTabRunShots(fromTabId);
  if (shots) await saveTabRunShots(toTabId, shots);
}
