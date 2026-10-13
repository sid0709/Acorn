import { useCallback, useEffect, useState } from "react";

import { clearTabLog, getTabLog, tabLogKey, type TabLogEntry } from "../tab-log-session";

/** The active tab's pipeline log, live: the service worker appends, this follows. */
export function useTabLog(tabId: number | null) {
  const [entries, setEntries] = useState<TabLogEntry[]>([]);

  useEffect(() => {
    if (tabId == null) {
      setEntries([]);
      return;
    }
    let alive = true;
    void getTabLog(tabId).then((stored) => {
      if (alive) setEntries(stored);
    });
    const key = tabLogKey(tabId);
    const onChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
      changes,
      area,
    ) => {
      if (area !== "session" || !changes[key]) return;
      const next = changes[key].newValue;
      setEntries(Array.isArray(next) ? (next as TabLogEntry[]) : []);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [tabId]);

  const clear = useCallback(() => {
    if (tabId != null) void clearTabLog(tabId);
  }, [tabId]);

  return { entries, clear };
}
