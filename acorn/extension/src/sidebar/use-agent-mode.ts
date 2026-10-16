import { useCallback, useEffect, useState } from "react";

import { AGENT_MODE_STORAGE_KEY, getAgentMode, setAgentMode } from "../agent/settings";

/** The Agent Run switch, kept in step with chrome.storage across sidebar windows. */
export function useAgentMode(): { enabled: boolean; setEnabled: (next: boolean) => void } {
  const [enabled, setLocal] = useState(true);

  useEffect(() => {
    let alive = true;
    void getAgentMode().then((value) => {
      if (alive) setLocal(value);
    });
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && AGENT_MODE_STORAGE_KEY in changes) {
        setLocal(changes[AGENT_MODE_STORAGE_KEY].newValue !== false);
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
    void setAgentMode(next);
  }, []);

  return { enabled, setEnabled };
}
