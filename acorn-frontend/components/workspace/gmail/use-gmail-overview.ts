"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchOverview, seedOverview } from "@/lib/gmail/client";
import type { GmailOverview } from "@/lib/gmail/types";

type Loaded = { mailboxId: string; overview: GmailOverview | null; error: string };

/** The mailbox's Google profile and labels with counts, for the sidebar. */
export function useGmailOverview(
  mailboxId: string,
  initial?: { mailboxId: string; overview: GmailOverview },
) {
  const [loaded, setLoaded] = useState<Loaded>(() => {
    if (!initial) return { mailboxId: "", overview: null, error: "" };
    seedOverview(initial.mailboxId, initial.overview);
    return { mailboxId: initial.mailboxId, overview: initial.overview, error: "" };
  });

  const settle = useCallback(
    (result: Awaited<ReturnType<typeof fetchOverview>>) =>
      setLoaded({
        mailboxId,
        overview: result.ok ? result.data : null,
        error: result.ok ? "" : result.message,
      }),
    [mailboxId],
  );

  useEffect(() => {
    if (!mailboxId) return;
    let live = true;
    void fetchOverview(mailboxId).then((result) => {
      if (live) settle(result);
    });
    return () => {
      live = false;
    };
  }, [mailboxId, settle]);

  const refresh = useCallback(
    async () => settle(await fetchOverview(mailboxId, true)),
    [mailboxId, settle],
  );

  const isCurrent = loaded.mailboxId === mailboxId;
  return {
    overview: isCurrent ? loaded.overview : null,
    error: isCurrent ? loaded.error : "",
    refresh,
  };
}
