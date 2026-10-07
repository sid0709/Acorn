/**
 * Each Chrome tab's AI usage, held by the service worker. The server pushes every
 * call it records (socket `ai-usage:recorded`, tagged with the tab's usage key);
 * the call lands in that tab's ledger and its view in chrome.storage.session,
 * where the sidebar renders it at once. A refresh reconciles with the server list.
 */

import {
  TabUsageLedger,
  addTallies,
  tallySummary,
  type TabUsageView,
  type UsageEntryRow,
  type UsageTally,
} from "@acorn/shared/tab-usage-ledger";

import { authHeaders, getAcornApiUrl } from "../auth/acorn-auth";
import { tabUsageStorageKey, usageTabKey } from "../tab-usage-key";

import type { AiUsageSummary } from "@acorn/shared/ai-usage";

/** Calls one tab's list keeps; the server's list returns as many. */
export const USAGE_LIST_MAX = 100;
/** A call's push can trail its response by a beat; a total waits this long first. */
const USAGE_PUSH_SETTLE_MS = 300;

const ledgers = new Map<string, Promise<TabUsageLedger>>();

/** The tab's ledger, picked back up from storage after the service worker restarts. */
function ledgerFor(usageKey: string): Promise<TabUsageLedger> {
  let ledger = ledgers.get(usageKey);
  if (!ledger) {
    ledger = chrome.storage.session
      .get(tabUsageStorageKey(usageKey))
      .then((stored) => {
        const view = stored[tabUsageStorageKey(usageKey)] as TabUsageView | undefined;
        return view?.entries
          ? TabUsageLedger.from(view, USAGE_LIST_MAX)
          : new TabUsageLedger(USAGE_LIST_MAX);
      })
      .catch(() => new TabUsageLedger(USAGE_LIST_MAX));
    ledgers.set(usageKey, ledger);
  }
  return ledger;
}

async function persist(usageKey: string, ledger: TabUsageLedger): Promise<void> {
  await chrome.storage.session.set({ [tabUsageStorageKey(usageKey)]: ledger.snapshot() });
}

/** The socket push: one call the server just recorded, for the tab it names. */
export async function recordPushedUsage(payload: unknown): Promise<void> {
  const { tab, entry } = (payload ?? {}) as { tab?: unknown; entry?: UsageEntryRow };
  if (typeof tab !== "string" || !tab || !entry?.id) return;
  const ledger = await ledgerFor(tab);
  if (ledger.append(entry)) await persist(tab, ledger);
}

/** Reconcile one tab's view with the server's list (the source of truth). */
export async function refreshTabUsage(tabId: number): Promise<void> {
  const usageKey = await usageTabKey(tabId);
  const base = (await getAcornApiUrl()).replace(/\/$/, "");
  const res = await fetch(`${base}/acorn/ai-usage?tab=${encodeURIComponent(usageKey)}`, {
    headers: await authHeaders(tabId),
  });
  const data = (await res.json().catch(() => ({}))) as {
    entries?: UsageEntryRow[];
    totalNanos?: number;
    error?: string;
    message?: string;
  };
  if (!res.ok) throw new Error(data.error || data.message || `Usage failed (${res.status})`);
  const ledger = await ledgerFor(usageKey);
  ledger.replace(Array.isArray(data.entries) ? data.entries : [], data.totalNanos ?? 0);
  await persist(usageKey, ledger);
}

/** Where a tab's usage stood when a fill or run began. */
export interface UsageMark {
  usageKey: string;
  tally: UsageTally;
}

export async function markTabUsage(tabId: number): Promise<UsageMark> {
  const usageKey = await usageTabKey(tabId);
  return { usageKey, tally: (await ledgerFor(usageKey)).mark() };
}

/**
 * Every call pushed to these tabs since their marks, as one summary. A final total
 * waits for pushes still in flight; a budget check mid-run reads what is there.
 */
export async function usageSince(
  marks: UsageMark[],
  opts: { settle?: boolean } = {},
): Promise<AiUsageSummary> {
  if (opts.settle !== false) {
    await new Promise((resolve) => setTimeout(resolve, USAGE_PUSH_SETTLE_MS));
  }
  const parts = await Promise.all(
    marks.map(async (mark) => (await ledgerFor(mark.usageKey)).since(mark.tally)),
  );
  return tallySummary(addTallies(parts));
}
