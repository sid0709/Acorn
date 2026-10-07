import { useCallback, useEffect, useState } from "react";

import {
  AUTO_FOCUS_STORAGE_KEY,
  getAutoFocusEnabled,
  setAutoFocusEnabled,
} from "../auto-focus-settings";

/** The Auto-Focus switch, kept in step with chrome.storage across sidebar windows. */
export function useAutoFocus(): { enabled: boolean; setEnabled: (next: boolean) => void } {
  const [enabled, setLocal] = useState(false);

  useEffect(() => {
    let alive = true;
    void getAutoFocusEnabled().then((value) => {
      if (alive) setLocal(value);
    });
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && AUTO_FOCUS_STORAGE_KEY in changes) {
        setLocal(changes[AUTO_FOCUS_STORAGE_KEY].newValue === true);
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
    void setAutoFocusEnabled(next);
  }, []);

  return { enabled, setEnabled };
}
