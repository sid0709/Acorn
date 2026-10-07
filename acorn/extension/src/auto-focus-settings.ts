/**
 * Auto-Focus: while Run works in more than one tab, the service worker brings each
 * run tab to the front in turn, so every page runs as a visible tab. The switch is
 * stored per browser; the pace comes from the build's env.
 */

/** chrome.storage.local key for the Auto-Focus switch. */
export const AUTO_FOCUS_STORAGE_KEY = "acornAutoFocus";

/** Seconds each run tab stays in front when VITE_ACORN_AUTO_FOCUS_SECONDS is unset or not a positive number. */
export const AUTO_FOCUS_DEFAULT_SECONDS = 4;

const MS_PER_SECOND = 1000;

/** The env's seconds per tab, or the default when the value is missing or invalid. */
export function autoFocusSeconds(): number {
  const seconds = Number(import.meta.env.VITE_ACORN_AUTO_FOCUS_SECONDS);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : AUTO_FOCUS_DEFAULT_SECONDS;
}

export function autoFocusIntervalMs(): number {
  return autoFocusSeconds() * MS_PER_SECOND;
}

export async function getAutoFocusEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get([AUTO_FOCUS_STORAGE_KEY]);
  return stored[AUTO_FOCUS_STORAGE_KEY] === true;
}

export async function setAutoFocusEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [AUTO_FOCUS_STORAGE_KEY]: enabled });
}
