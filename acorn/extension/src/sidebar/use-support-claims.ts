import {
  SUPPORT_CLAIMS_PATH,
  supportClaimMessagesPath,
  supportClaimPath,
  supportClaimReadPath,
  type ClaimThreadData,
  type SupportClaim,
} from "@acorn/support-chat";
import { useCallback, useEffect, useState } from "react";

import { authHeaders, getAcornApiUrl } from "../auth/acorn-auth";
import { MSG } from "../types";

/** How often the open Support tab checks for replies while the socket is down. */
const SUPPORT_OFFLINE_POLL_MS = 15_000;

type ErrorBody = { error?: string; message?: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = (await getAcornApiUrl()).replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, { ...init, headers: await authHeaders() });
  const data = (await res.json().catch(() => ({}))) as T & ErrorBody;
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data;
}

/**
 * The person's reports and the open one's conversation. Reloads when the server
 * pushes a change (a reply, opened, closed), and every SUPPORT_OFFLINE_POLL_MS
 * while the socket is down and the tab is shown.
 */
export function useSupportClaims({
  signedIn,
  visible,
  connected,
}: {
  signedIn: boolean;
  visible: boolean;
  connected: boolean;
}) {
  const [claims, setClaims] = useState<SupportClaim[]>([]);
  const [unread, setUnread] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<ClaimThreadData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadList = useCallback(async () => {
    if (!signedIn) return;
    setLoading(true);
    try {
      const body = await api<{ claims: SupportClaim[]; unread: number }>(SUPPORT_CLAIMS_PATH);
      setClaims(body.claims ?? []);
      setUnread(body.unread ?? 0);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [signedIn]);

  const loadThread = useCallback(async (id: string) => {
    const body = await api<ClaimThreadData>(supportClaimPath(id));
    setThread(body);
    if (body.claim.unread) {
      await api(supportClaimReadPath(id), { method: "POST" }).catch(() => undefined);
    }
  }, []);

  const refresh = useCallback(async () => {
    await loadList();
    if (openId) await loadThread(openId).catch(() => undefined);
  }, [loadList, loadThread, openId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);

  useEffect(() => {
    const onMessage = (message: { type?: string }) => {
      if (message?.type === MSG.SUPPORT_CLAIMS_CHANGED) void refresh();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [refresh]);

  useEffect(() => {
    if (connected || !visible || !signedIn) return;
    const timer = setInterval(() => void refresh(), SUPPORT_OFFLINE_POLL_MS);
    return () => clearInterval(timer);
  }, [connected, visible, signedIn, refresh]);

  const open = useCallback(
    async (id: string | null) => {
      setOpenId(id);
      setThread(null);
      if (!id) return;
      try {
        await loadThread(id);
        await loadList();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [loadList, loadThread],
  );

  const send = useCallback(
    async (body: string) => {
      if (!openId) return;
      await api(supportClaimMessagesPath(openId), {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      await loadThread(openId);
      await loadList();
    },
    [openId, loadList, loadThread],
  );

  return { claims, unread, thread, openId, loading, error, open, send, reload: refresh };
}
