/**
 * One Chrome tab's AI usage as the extension holds it: the list the sidebar shows
 * and running totals a fill or run reads "since I began". Calls arrive one by one
 * as the server records them (socket push) and are reconciled with the server's
 * list, which stays the source of truth. Costs are integer nanodollars, so totals
 * add up exactly.
 */

import type { AiUsageSummary } from "./ai-usage";

/** USD → the server's cost unit. */
export const NANOS_PER_USD = 1e9;

/** One recorded model call, as GET /acorn/ai-usage and the socket push send it. */
export interface UsageEntryRow {
  id: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Part of promptTokens read from the provider's prompt cache. */
  cachedTokens?: number;
  /** Part of promptTokens written to the prompt cache. */
  cacheWriteTokens?: number;
  totalTokens: number;
  /** Formatted for display; empty when the call has no price. */
  price: string;
  costNanos: number;
  priced: boolean;
  durationMs: number;
  error: string;
  /** Server time (ISO), so entries from the list and the push sort together. */
  createdAt: string;
}

/** What the sidebar renders for a tab. */
export interface TabUsageView {
  entries: UsageEntryRow[];
  totalNanos: number;
}

/** Running totals of the calls pushed to this tab. */
export interface UsageTally {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalTokens: number;
  costNanos: number;
  unpriced: number;
  /** Models in the order their calls arrived (one per call). */
  models: string[];
}

export const EMPTY_TAB_USAGE: TabUsageView = { entries: [], totalNanos: 0 };

function emptyTally(): UsageTally {
  return {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
    costNanos: 0,
    unpriced: 0,
    models: [],
  };
}

function newestFirst(a: UsageEntryRow, b: UsageEntryRow): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

export class TabUsageLedger {
  private view: TabUsageView = { entries: [], totalNanos: 0 };
  private readonly tally: UsageTally = emptyTally();
  private readonly seen = new Set<string>();

  constructor(private readonly maxEntries: number) {}

  /** Start from a stored view (after the service worker restarts). */
  static from(view: TabUsageView, maxEntries: number): TabUsageLedger {
    const ledger = new TabUsageLedger(maxEntries);
    ledger.view = { entries: [...view.entries], totalNanos: view.totalNanos };
    for (const entry of view.entries) ledger.seen.add(entry.id);
    return ledger;
  }

  /** One pushed call. False when it was already here (the list or an earlier push). */
  append(entry: UsageEntryRow): boolean {
    if (!entry.id || this.seen.has(entry.id)) return false;
    this.seen.add(entry.id);
    this.view = {
      entries: [entry, ...this.view.entries].sort(newestFirst).slice(0, this.maxEntries),
      totalNanos: this.view.totalNanos + (entry.costNanos || 0),
    };
    const t = this.tally;
    t.calls += 1;
    t.promptTokens += entry.promptTokens || 0;
    t.completionTokens += entry.completionTokens || 0;
    t.cachedTokens += entry.cachedTokens || 0;
    t.totalTokens += entry.totalTokens || 0;
    t.costNanos += entry.costNanos || 0;
    if (!entry.priced) t.unpriced += 1;
    t.models.push(entry.model);
    return true;
  }

  /**
   * The server's list and total win. Pushed calls newer than its newest entry
   * arrived after the server read its list, so they are kept and added on top.
   */
  replace(server: UsageEntryRow[], serverTotalNanos: number): void {
    const listed = new Set(server.map((entry) => entry.id));
    const newestListed = server.reduce(
      (newest, entry) => Math.max(newest, Date.parse(entry.createdAt) || 0),
      0,
    );
    const later = this.view.entries.filter(
      (entry) => !listed.has(entry.id) && Date.parse(entry.createdAt) > newestListed,
    );
    for (const id of listed) this.seen.add(id);
    this.view = {
      entries: [...later, ...server].sort(newestFirst).slice(0, this.maxEntries),
      totalNanos: serverTotalNanos + later.reduce((sum, entry) => sum + (entry.costNanos || 0), 0),
    };
  }

  snapshot(): TabUsageView {
    return { entries: [...this.view.entries], totalNanos: this.view.totalNanos };
  }

  /** The totals now, to compare with later. */
  mark(): UsageTally {
    return { ...this.tally, models: [...this.tally.models] };
  }

  /** Calls pushed since `mark`. */
  since(mark: UsageTally): UsageTally {
    const t = this.tally;
    return {
      calls: t.calls - mark.calls,
      promptTokens: t.promptTokens - mark.promptTokens,
      completionTokens: t.completionTokens - mark.completionTokens,
      cachedTokens: t.cachedTokens - mark.cachedTokens,
      totalTokens: t.totalTokens - mark.totalTokens,
      costNanos: t.costNanos - mark.costNanos,
      unpriced: t.unpriced - mark.unpriced,
      models: t.models.slice(mark.models.length),
    };
  }
}

/** Several tallies as one (a run that moved through more than one tab). */
export function addTallies(tallies: UsageTally[]): UsageTally {
  return tallies.reduce<UsageTally>(
    (sum, t) => ({
      calls: sum.calls + t.calls,
      promptTokens: sum.promptTokens + t.promptTokens,
      completionTokens: sum.completionTokens + t.completionTokens,
      cachedTokens: sum.cachedTokens + t.cachedTokens,
      totalTokens: sum.totalTokens + t.totalTokens,
      costNanos: sum.costNanos + t.costNanos,
      unpriced: sum.unpriced + t.unpriced,
      models: [...sum.models, ...t.models],
    }),
    emptyTally(),
  );
}

/** A tally in the summary shape fills and runs report. */
export function tallySummary(t: UsageTally): AiUsageSummary {
  const models = [...new Set(t.models.filter(Boolean))];
  return {
    model: models.join("+") || null,
    inputTokens: t.promptTokens,
    outputTokens: t.completionTokens,
    cachedInputTokens: t.cachedTokens,
    totalTokens: t.totalTokens,
    costUsd: t.costNanos / NANOS_PER_USD,
    priced: t.unpriced === 0,
    calls: t.calls,
  };
}

/** Nanodollars as the server formats them ("0.000074710"): exact, no float rounding. */
export function formatNanosUsd(nanos: number): string {
  const whole = Math.floor(Math.max(0, nanos) / NANOS_PER_USD);
  const frac = Math.max(0, nanos) % NANOS_PER_USD;
  return `${whole}.${String(frac).padStart(9, "0")}`;
}
