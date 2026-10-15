import { addressOf } from "./run-step";

import type { FieldIssueScan } from "@acorn/shared/field-issues";
import type { FormField } from "@acorn/shared/form-fields";
import type { PlanAction, RunStepRecord } from "@acorn/shared/plan-runner/types";

/**
 * Documents the run already gave a page. A page that takes an upload and then draws
 * itself again (it reads the résumé on its server and rebuilds the form) shows the
 * attached file in its own words, or not at all; the file input is empty again. Without
 * a memory the next plan uploads the same document again, the page draws itself again,
 * and the run goes in circles until it runs out of reloads. The memory is the run's own
 * record of what it delivered to which field of which page: never the page's wording.
 * A field the page flags is not remembered as delivered: it is asked for again.
 */

const FILE_ACTIONS = new Set(["upload", "resume_upload"]);

const byTab = new Map<number, Set<string>>();

const labelKey = (label: string | null | undefined) =>
  (label ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const keyOf = (url: string, label: string | null | undefined) =>
  `${addressOf(url)}\u0000${labelKey(label)}`;

/** A new run on this tab starts with no memory. */
export function forgetDeliveredFiles(tabId: number): void {
  byTab.delete(tabId);
}

/** The page at `url` moved on to another step: what was delivered to the last one is not this one's. */
export function forgetDeliveredAt(tabId: number, url: string): void {
  const set = byTab.get(tabId);
  if (!set) return;
  const address = `${addressOf(url)}\u0000`;
  for (const key of [...set]) if (key.startsWith(address)) set.delete(key);
}

/** Remember the uploads of a plan whose steps went through. */
export function noteDeliveredFiles(
  tabId: number,
  url: string,
  actions: readonly PlanAction[],
  steps: readonly RunStepRecord[],
): void {
  for (const step of steps) {
    const action = actions[step.index];
    if (!action || !FILE_ACTIONS.has(action.action) || step.status !== "ok") continue;
    if (!action.expected_label) continue;
    const set = byTab.get(tabId) ?? new Set<string>();
    set.add(keyOf(url, action.expected_label));
    byTab.set(tabId, set);
  }
}

/** Whether this document field was already given its file on this page. */
function delivered(tabId: number, url: string, label: string | null | undefined): boolean {
  return byTab.get(tabId)?.has(keyOf(url, label)) ?? false;
}

/**
 * The plan without the uploads the page already took, except to a field the page flags
 * (the upload did not take) or that the plan is only there to fix (a refill).
 */
export function withoutDeliveredUploads<T extends Pick<PlanAction, "action" | "expected_label">>(
  tabId: number,
  url: string,
  actions: readonly T[],
  flaggedLabels: ReadonlySet<string>,
): T[] {
  return actions.filter(
    (action) =>
      !(
        FILE_ACTIONS.has(action.action) &&
        delivered(tabId, url, action.expected_label) &&
        !flaggedLabels.has(labelKey(action.expected_label))
      ),
  );
}

/** Labels of the fields the page marks invalid or ties a message to. */
export function flaggedLabelsOf(
  fields: readonly FormField[] | undefined,
  scan: FieldIssueScan | undefined,
): Set<string> {
  const flagged = new Set<number>(
    (scan?.issues ?? [])
      .filter((issue) => issue.invalid || issue.linkedMessages.length > 0)
      .map((issue) => issue.elementIndex),
  );
  return new Set(
    (fields ?? []).filter((field) => flagged.has(field.elementIndex)).map((f) => labelKey(f.label)),
  );
}

/**
 * The page's issue scan without the file inputs the run delivered a file to: the input
 * reads empty whatever the page did with the file, so "required and empty" is not news.
 */
export function scanWithoutDelivered(
  tabId: number,
  url: string,
  scan: FieldIssueScan,
  fields: readonly FormField[],
): FieldIssueScan {
  const held = new Set(
    fields
      .filter((field) => field.kind === "file" && delivered(tabId, url, field.label))
      .map((field) => field.elementIndex),
  );
  if (!held.size) return scan;
  return {
    ...scan,
    issues: scan.issues.filter((issue) => !(held.has(issue.elementIndex) && !issue.invalid)),
  };
}
