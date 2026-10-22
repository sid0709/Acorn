import { fetchTabCost } from "./ai-client";
import { patchPage } from "../tab-page-session";

/**
 * Reads what the models cost this page from the backend (the sum of the tab's usage rows) and
 * keeps it on the page. The figure is never estimated here; a failed read leaves the old one.
 */
export async function refreshPageCost(tabId: number, apiUrl?: string): Promise<void> {
  try {
    const cost = await fetchTabCost(tabId, apiUrl);
    await patchPage(tabId, { costNanos: cost.costNanos, costCalls: cost.calls });
  } catch {
    /* keep the last figure */
  }
}
