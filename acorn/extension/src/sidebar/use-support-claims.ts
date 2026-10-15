import {
  SUPPORT_CLAIMS_PATH,
  messageFormData,
  recordPushDelay,
  supportClaimMessagesPath,
  supportClaimPath,
  supportClaimReadPath,
  supportClaimReopenPath,
  type ClaimPush,
  type ClaimThreadData,
  type MessageDraft,
  type SupportClaim,
  type SupportMessage,
} from "@acorn/support-chat";
import { useCallback, useEffect, useRef, useState } from "react";

import { authHeaders, getAcornApiUrl } from "../auth/acorn-auth";
import { MSG } from "../types";

import { useClaimAttachments } from "./use-claim-attachments";

/** How often the open Support tab checks for replies while the socket is down. */
const SUPPORT_OFFLINE_POLL_MS = 15_000;

type ErrorBody = { error?: string; message?: string };

/** What sending a message or reopening answers. */
type Posted = { claim: SupportClaim; message?: SupportMessage };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = (await getAcornApiUrl()).replace(/\/$/, "");
  const headers = await authHeaders();
  // A multipart body sets its own Content-Type, boundary included.
  if (init?.body instanceof FormData) delete headers["Content-Type"];
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & ErrorBody;
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data;
}

/** The reports with this one in its place: recent conversations first, as the server lists them. */
function withClaim(claims: SupportClaim[], claim: SupportClaim): SupportClaim[] {
  const others = claims.filter((row) => row.id !== claim.id);
  return [...others, claim].sort(
    (a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt),
  );
}

/** The thread with the pushed claim and, when new, the pushed message. The open thread is read. */
function withChange(thread: ClaimThreadData, claim: SupportClaim, message?: SupportMessage) {
  const known = !message || thread.messages.some((m) => m.id === message.id);
  return {
    claim: { ...claim, unread: false },
    messages: known ? thread.messages : [...thread.messages, message],
  };
}

/**
 * The person's reports and the open one's conversation. A change the server pushes
 * (a message from either side, opened, closed) lands in the open thread and in the list at
 * once, with no request. Every SUPPORT_OFFLINE_POLL_MS while the socket is down
 * and the tab is shown, and once when it comes back, everything reloads.
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
    await Promise.all([loadList(), openId ? loadThread(openId).catch(() => undefined) : null]);
  }, [loadList, loadThread, openId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Showing the tab reloads once. Opening a claim changes `refresh`, which must not reload again:
  // open() already loads that thread.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (visible) void refreshRef.current();
  }, [visible]);

  useEffect(() => {
    const onMessage = (message: { type?: string; payload?: ClaimPush }) => {
      if (message?.type !== MSG.SUPPORT_CLAIMS_CHANGED) return;
      const push = message.payload ?? {};
      const claim = push.claim;
      if (!claim?.id) {
        void refresh();
        return;
      }
      recordPushDelay(push, push.message ? "support:message" : "support:claim");
      const isOpen = claim.id === openId;
      if (isOpen) {
        setThread((current) =>
          current?.claim.id === claim.id ? withChange(current, claim, push.message) : current,
        );
        if (claim.unread) {
          void api(supportClaimReadPath(claim.id), { method: "POST" }).catch(() => undefined);
        }
      }
      // The open conversation is being read, whatever the push says.
      setClaims((current) => withClaim(current, isOpen ? { ...claim, unread: false } : claim));
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [refresh, openId]);

  // Pushes sent while the socket was down are gone; reload once when it comes back.
  const link = useRef({ connected, everConnected: connected });
  useEffect(() => {
    const cameBack = connected && !link.current.connected && link.current.everConnected;
    link.current = { connected, everConnected: link.current.everConnected || connected };
    if (cameBack && signedIn) void refresh();
  }, [connected, signedIn, refresh]);

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
        // The list is already on screen; opening only reads this claim, which clears its dot.
        await loadThread(id);
        setClaims((current) =>
          current.map((claim) => (claim.id === id ? { ...claim, unread: false } : claim)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [loadThread],
  );

  /** Shows what the server answered in the open thread and in the list. */
  const applyPosted = useCallback((id: string, posted: Posted) => {
    setThread((current) =>
      current?.claim.id === id ? withChange(current, posted.claim, posted.message) : current,
    );
    setClaims((current) => withClaim(current, { ...posted.claim, unread: false }));
  }, []);

  const send = useCallback(
    async (draft: MessageDraft) => {
      if (!openId) return;
      const posted = await api<Posted>(supportClaimMessagesPath(openId), {
        method: "POST",
        body: messageFormData(draft),
      });
      applyPosted(openId, posted);
    },
    [openId, applyPosted],
  );

  /** Reopens the open, resolved report; rejects with the server's message. */
  const reopen = useCallback(async () => {
    if (!openId) return;
    applyPosted(openId, await api<Posted>(supportClaimReopenPath(openId), { method: "POST" }));
  }, [openId, applyPosted]);

  const { src: attachmentSrc, loadFull: openAttachments } = useClaimAttachments(thread);
  const unread = claims.filter((claim) => claim.unread).length;

  return {
    claims,
    unread,
    thread,
    openId,
    loading,
    error,
    open,
    send,
    reopen,
    attachmentSrc,
    openAttachments,
    reload: refresh,
  };
}
