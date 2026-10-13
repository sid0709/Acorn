import { useCallback, useEffect, useState } from "react";

import { clearTabLog, getTabLog, onTabLogChange, type TabLogEntry } from "../tab-log-session";

/** The active tab's pipeline log, live: the service worker appends, this follows. */
export function useTabLog(tabId: number | null) {
  const [entries, setEntries] = useState<TabLogEntry[]>([]);

  useEffect(() => {
    if (tabId == null) {
      setEntries([]);
      return;
    }
    let alive = true;
    // Writes that land while the stored log is read are applied after it, never lost.
    const early: TabLogEntry[] = [];
    let loaded = false;
    const stop = onTabLogChange((change) => {
      if (change.tabId !== tabId) return;
      if ("cleared" in change) {
        early.length = 0;
        setEntries([]);
        return;
      }
      if (!loaded) early.push(...change.added);
      else setEntries((shown) => [...shown, ...change.added]);
    });
    void getTabLog(tabId)
      .then((stored) => {
        if (!alive) return;
        const known = new Set(stored.map((entry) => entry.id));
        setEntries([...stored, ...early.filter((entry) => !known.has(entry.id))]);
        loaded = true;
      })
      .catch(() => {
        if (alive) loaded = true;
      });
    return () => {
      alive = false;
      stop();
    };
  }, [tabId]);

  const clear = useCallback(() => {
    if (tabId != null) void clearTabLog(tabId);
  }, [tabId]);

  return { entries, clear };
}
