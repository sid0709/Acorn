import { markTabUsage, usageSince, type UsageMark } from "../background/tab-usage-store";

import type { AiUsageSummary } from "@acorn/shared/ai-usage";

/**
 * A fill's AI cost: every call the server recorded for this tab between the
 * fill's start and end. The server pushes each call as it records it (see
 * background/tab-usage-store.ts), so nothing a fill triggers is missed — the
 * planner, the writer, every decision, and calls the page's content script asked
 * for. Tabs never mix: each has its own usage key.
 */
const marks = new Map<number, Promise<UsageMark | null>>();

export function beginPipelineUsageTracking(tabId: number): void {
  marks.set(
    tabId,
    markTabUsage(tabId).catch(() => null),
  );
}

export async function endPipelineUsageTracking(tabId: number): Promise<AiUsageSummary | null> {
  const mark = await marks.get(tabId);
  marks.delete(tabId);
  return mark ? usageSince([mark]).catch(() => null) : null;
}

export function rekeyPipelineUsage(fromTabId: number, toTabId: number): void {
  if (fromTabId === toTabId) return;
  const mark = marks.get(fromTabId);
  if (!mark) return;
  marks.delete(fromTabId);
  if (!marks.has(toTabId)) marks.set(toTabId, mark);
}
