import { useCallback, useEffect, useState } from "react";

import { clearTabLog, getTabLog, onTabLogChange, type TabLogEntry } from "../tab-log-session";

/** Shown entries plus new ones, each once, oldest first. */
function inTimeOrder(shown: TabLogEntry[], added: TabLogEntry[]): TabLogEntry[] {
  const known = new Set(shown.map((entry) => entry.id));
  const fresh = added.filter((entry) => !known.has(entry.id));
  return [...shown, ...fresh].sort((a, b) => a.t - b.t);
}

/** The active tab's pipeline log, live: the service worker appends, this follows. */
export function useTabLog(tabId: number | null) {
  const [entries, setEntries] = useState<TabLogEntry[]>([]);
  // Entries a write failed to keep, since the log was opened: the panel says so.
  const [lost, setLost] = useState(0);

  useEffect(() => {
    setLost(0);
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
      if ("lost" in change) {
        setLost((count) => count + change.lost);
        return;
      }
      if (!loaded) early.push(...change.added);
      // A log moved over from another tab holds earlier entries: keep time order.
      else setEntries((shown) => inTimeOrder(shown, change.added));
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

  return { entries, clear, lost };
}
