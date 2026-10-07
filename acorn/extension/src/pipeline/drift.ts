import { sendTabMessage } from "../tab-messaging";
import { MSG } from "../types";

/** Replaying a page's answers types and opens dropdowns, so it gets a step's budget. */
const DRIFT_REPAIR_TIMEOUT_MS = 60_000;

export interface DriftRepair {
  checked: number;
  repaired: number;
  failed: string[];
}

const NO_REPAIR: DriftRepair = { checked: 0, repaired: 0, failed: [] };

/**
 * Put back the answers this fill gave (steps since `since`) that the page has
 * since cleared or changed. Fails open: a frame that cannot answer repairs nothing.
 */
export async function repairDriftInTab(
  tabId: number,
  frameId: number | null,
  since: number,
): Promise<DriftRepair> {
  const res = await sendTabMessage<Partial<DriftRepair> & { ok?: boolean }>(
    tabId,
    { type: MSG.REPAIR_DRIFT, since },
    frameId ?? undefined,
    DRIFT_REPAIR_TIMEOUT_MS,
  ).catch(() => null);
  if (!res?.ok) return NO_REPAIR;
  return { checked: res.checked ?? 0, repaired: res.repaired ?? 0, failed: res.failed ?? [] };
}
