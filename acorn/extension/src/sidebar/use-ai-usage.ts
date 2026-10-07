import { useCallback, useEffect, useRef, useState } from "react";

import {
  EMPTY_TAB_USAGE,
  formatNanosUsd,
  type TabUsageView,
  type UsageEntryRow,
} from "@acorn/shared/tab-usage-ledger";

import { authHeaders, getAcornApiUrl } from "../auth/acorn-auth";
import { tabUsageStorageKey, usageTabKey } from "../tab-usage-key";
import { MSG } from "../types";

import { sendMessage } from "./runtime";

/** Reconcile interval while the socket is down and calls cannot be pushed. */
const USAGE_OFFLINE_POLL_MS = 4_000;

/** One recorded call, as the server lists and pushes it. */
export type AiUsageEntry = UsageEntryRow;

const EMPTY_REQUEST = "This call was recorded before request bodies were saved.";

/** The provider JSON for one call. The list poll does not include it. */
export async function fetchUsageRequest(id: string, tabId: number): Promise<string> {
  const base = (await getAcornApiUrl()).replace(/\/$/, "");
  const res = await fetch(`${base}/acorn/ai-usage/${encodeURIComponent(id)}`, {
    headers: await authHeaders(tabId),
  });
  const data = (await res.json().catch(() => ({}))) as {
    entry?: { request?: string };
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || data.message || `Usage failed (${res.status})`);
  }
  const request = data.entry?.request?.trim() ?? "";
  return request || EMPTY_REQUEST;
}

export function formatUsagePrice(price: string | null | undefined): string {
  if (!price) return "—";
  const [wholeRaw, fracRaw = ""] = price.split(".");
  if (!/^\d+$/.test(wholeRaw) || (fracRaw !== "" && !/^\d+$/.test(fracRaw))) return "—";
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const trimmed = fracRaw.replace(/0+$/, "");
  const frac = trimmed.length < 2 ? `${trimmed}00`.slice(0, 2) : trimmed.slice(0, 8);
  return `$${whole}.${frac}`;
}

/**
 * This Chrome tab's AI calls. A different tab has a different list. The list is
 * the service worker's view for this tab's usage key: every call the server
 * records is pushed into it the moment it ends, and this hook re-renders from
 * storage at once. One reconcile with the server runs when the tab is shown;
 * polling runs only while the socket is down and nothing can be pushed.
 */
export function useAiUsage(
  tabId: number | null,
  active: boolean,
  signedIn: boolean,
  socketConnected: boolean,
) {
  const [view, setView] = useState<TabUsageView>(EMPTY_TAB_USAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (tabId == null || !signedIn) return;
    const res = await sendMessage<{ ok?: boolean; error?: string }>({
      type: MSG.REFRESH_TAB_USAGE,
      tabId,
    }).catch((err: unknown) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }));
    setError(res?.ok ? null : (res?.error ?? "Usage failed"));
  }, [signedIn, tabId]);

  // Render this tab's stored view, and every change to it, for as long as it is shown.
  useEffect(() => {
    setView(EMPTY_TAB_USAGE);
    setError(null);
    if (!active || !signedIn || tabId == null) return;
    let alive = true;
    let storageKey: string | null = null;
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "session" || !storageKey || !(storageKey in changes)) return;
      setView((changes[storageKey].newValue as TabUsageView | undefined) ?? EMPTY_TAB_USAGE);
    };
    chrome.storage.onChanged.addListener(onChanged);
    void (async () => {
      const key = tabUsageStorageKey(await usageTabKey(tabId));
      if (!alive) return;
      storageKey = key;
      const stored = await chrome.storage.session.get(key);
      if (alive) setView((stored[key] as TabUsageView | undefined) ?? EMPTY_TAB_USAGE);
      setLoading(true);
      await refresh();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [active, refresh, signedIn, tabId]);

  // Pushes cannot arrive without the socket: reconcile on a timer until it is back.
  useEffect(() => {
    if (!active || !signedIn || tabId == null || socketConnected) return;
    const timer = window.setInterval(() => void refresh(), USAGE_OFFLINE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh, signedIn, socketConnected, tabId]);

  // A reconnect may have missed pushes: reconcile once when the socket comes back.
  const wasConnected = useRef(socketConnected);
  useEffect(() => {
    const reconnected = socketConnected && !wasConnected.current;
    wasConnected.current = socketConnected;
    if (active && reconnected) void refresh();
  }, [active, refresh, socketConnected]);

  const reload = useCallback(() => {
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  return {
    entries: view.entries,
    totalPrice: formatNanosUsd(view.totalNanos),
    loading,
    error,
    reload,
  };
}
