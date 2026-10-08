import { useCallback, useEffect, useState } from "react";

import {
  STOP_BEFORE_SUBMIT_STORAGE_KEY,
  getStopBeforeSubmit,
  setStopBeforeSubmit,
} from "../run-settings";

/** The Stop before Submit switch, kept in step with chrome.storage across sidebar windows. */
export function useStopBeforeSubmit(): { enabled: boolean; setEnabled: (next: boolean) => void } {
  const [enabled, setLocal] = useState(false);

  useEffect(() => {
    let alive = true;
    void getStopBeforeSubmit().then((value) => {
      if (alive) setLocal(value);
    });
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && STOP_BEFORE_SUBMIT_STORAGE_KEY in changes) {
        setLocal(changes[STOP_BEFORE_SUBMIT_STORAGE_KEY].newValue === true);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setLocal(next);
    void setStopBeforeSubmit(next);
  }, []);

  return { enabled, setEnabled };
}
