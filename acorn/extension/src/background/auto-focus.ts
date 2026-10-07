import {
  AUTO_FOCUS_STORAGE_KEY,
  autoFocusIntervalMs,
  getAutoFocusEnabled,
} from "../auto-focus-settings";
import { focusChromeTab } from "../focus-tab";

import { runTabIds } from "./work-state";

/** The rotation's timer while it is on; null while Auto-Focus is off or no Run is working. */
let timer: ReturnType<typeof setInterval> | null = null;
/** The run tab brought to the front last; the next tick moves on from it. */
let lastFocused: number | null = null;

/** The run tab after the last one focused, in the order the runs started. */
function nextRunTab(): number | null {
  const tabs = [...runTabIds];
  if (!tabs.length) return null;
  const at = lastFocused == null ? -1 : tabs.indexOf(lastFocused);
  return tabs[(at + 1) % tabs.length];
}

async function focusNextRunTab(): Promise<void> {
  const tabId = nextRunTab();
  if (tabId == null) return;
  lastFocused = tabId;
  await focusChromeTab(tabId);
}

function stop(): void {
  if (timer != null) clearInterval(timer);
  timer = null;
  lastFocused = null;
}

/**
 * Starts the rotation when Auto-Focus is on and Run is working in more than one
 * tab, and stops it otherwise. Call it whenever a run starts or ends.
 */
export async function syncAutoFocus(): Promise<void> {
  const wanted = runTabIds.size > 1 && (await getAutoFocusEnabled());
  if (!wanted) {
    stop();
    return;
  }
  if (timer != null) return;
  void focusNextRunTab();
  timer = setInterval(() => void focusNextRunTab(), autoFocusIntervalMs());
}

/** Turning the switch on or off takes effect at once, mid-run. */
export function bindAutoFocusSetting(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && AUTO_FOCUS_STORAGE_KEY in changes) void syncAutoFocus();
  });
}
