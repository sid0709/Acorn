import { useCallback, useEffect, useRef, useState } from "react";

import { fetchGmailConnectionStatus } from "../agent/gmail-connection";

import type { SidebarAuth } from "./sidebar-panel-types";

/** The soonest a window focus asks again: the status is shown all the time, and a focus is not a change. */
const GMAIL_STATUS_MIN_REFRESH_MS = 15_000;

export interface GmailStatus {
  loading: boolean;
  connected: boolean;
  email?: string;
}

/**
 * Whether the signed-in Acorn account has Gmail connected on the website. Read when the sidebar opens, when the
 * account or API changes, and when the window is focused again (a person who connected Gmail on the website
 * comes back to this sidebar), so the status shown on the sidebar is current without a visit to Settings.
 */
export function useGmailStatus(
  session: SidebarAuth["session"],
  apiUrl: SidebarAuth["apiUrl"],
): GmailStatus {
  const [status, setStatus] = useState<GmailStatus>({ loading: false, connected: false });
  const lastReadAt = useRef(0);
  const token = session?.accessToken;

  const read = useCallback(
    (isCurrent: () => boolean) => {
      if (!token) {
        setStatus({ loading: false, connected: false });
        return;
      }
      lastReadAt.current = Date.now();
      setStatus((previous) => ({ ...previous, loading: true }));
      void fetchGmailConnectionStatus(token, apiUrl)
        .then((result) => {
          if (isCurrent())
            setStatus({ loading: false, connected: result.connected, email: result.email });
        })
        .catch(() => {
          if (isCurrent()) setStatus({ loading: false, connected: false });
        });
    },
    [token, apiUrl],
  );

  useEffect(() => {
    let current = true;
    const isCurrent = () => current;
    read(isCurrent);
    const onFocus = () => {
      if (Date.now() - lastReadAt.current >= GMAIL_STATUS_MIN_REFRESH_MS) read(isCurrent);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      current = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [read]);

  return status;
}
