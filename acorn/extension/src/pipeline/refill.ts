import {
  EMPTY_FIELD_ISSUE_SCAN,
  countFlaggedFields,
  type FieldIssueScan,
} from "@acorn/shared/field-issues";
import { sendTabMessage } from "../tab-messaging";
import { MSG } from "../types";

/** The after-check waits for the page to settle, then scans. */
const REFILL_RESCAN_TIMEOUT_MS = 30_000;

/** An older backend ignores Refill and returns a full Fill plan; never force-run that. */
export const REFILL_UNSUPPORTED =
  "This Acorn server doesn't support Refill yet. Update acorn-backend, then try again.";

export const REFILL_NOTHING_FLAGGED =
  "No flagged fields found. Click Submit or Next first, then Refill.";

export function refillAnalyzingMessage(scan: FieldIssueScan): string {
  const count = scan.issues.length;
  return `Refill · checking ${count} field${count === 1 ? "" : "s"} the page flagged`;
}

/** Re-read the page's errors after Refill ran, on the same frame and tree ids. */
export async function rescanFieldIssues(
  tabId: number,
  frameId: number | null,
): Promise<FieldIssueScan> {
  const res = await sendTabMessage<{ ok?: boolean; scan?: FieldIssueScan; error?: string }>(
    tabId,
    { type: MSG.SCAN_FIELD_ISSUES },
    frameId ?? undefined,
    REFILL_RESCAN_TIMEOUT_MS,
  );
  return res?.ok && res.scan ? res.scan : EMPTY_FIELD_ISSUE_SCAN;
}

/** "· 2 still flagged" when the page still marks fields invalid after Refill. */
export function refillResultSuffix(after: FieldIssueScan): string {
  const flagged = countFlaggedFields(after);
  return flagged ? ` · ${flagged} still flagged` : "";
}
