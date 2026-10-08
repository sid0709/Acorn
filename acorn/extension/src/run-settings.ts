/**
 * Stop before Submit: Run fills every step of an application, and on the last one
 * stops at the control that sends it instead of clicking it, so the person reviews
 * and submits. Stored per browser; off sends the application.
 */

/** chrome.storage.local key for the Stop before Submit switch. */
export const STOP_BEFORE_SUBMIT_STORAGE_KEY = "acornStopBeforeSubmit";

export async function getStopBeforeSubmit(): Promise<boolean> {
  const stored = await chrome.storage.local.get([STOP_BEFORE_SUBMIT_STORAGE_KEY]);
  return stored[STOP_BEFORE_SUBMIT_STORAGE_KEY] === true;
}

export async function setStopBeforeSubmit(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [STOP_BEFORE_SUBMIT_STORAGE_KEY]: enabled });
}
