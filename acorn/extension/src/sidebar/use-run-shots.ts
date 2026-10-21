import { useEffect, useState } from "react";

import {
  readTabRunShots,
  runShotsFromStored,
  tabRunShotsKey,
  type TabRunShots,
} from "../tab-run-shots";

/** The pictures the model last saw on a tab (`tab-run-shots.ts`), kept current as the run saves new ones. */
export function useRunShots(tabId: number | null): TabRunShots | null {
  const [shots, setShots] = useState<TabRunShots | null>(null);
  useEffect(() => {
    setShots(null);
    if (tabId == null) return;
    let alive = true;
    const key = tabRunShotsKey(tabId);
    readTabRunShots(tabId)
      .then((stored) => {
        if (alive) setShots(stored);
      })
      .catch(() => {
        if (alive) setShots(null);
      });
    const onChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
      changes,
      area,
    ) => {
      if (area !== "session" || !(key in changes)) return;
      setShots(runShotsFromStored(changes[key]?.newValue));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [tabId]);
  return shots;
}
