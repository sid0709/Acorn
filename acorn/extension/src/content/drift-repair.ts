/**
 * Put back answers the page took away after a fill: a résumé import that rewrites
 * the form, a field that resets when another one changes. Each answer a plan step
 * gave is checked against what its control shows now, and only a control that no
 * longer shows it is answered again, with the same value. No model call.
 */

import { traceFromPage } from "../debug-trace";

import { controlAlreadyMatches } from "./agents/already-filled";
import { plannedFillsSince } from "./agents/plan-fill-registry";
import { readControlValue } from "./agents/read-control-value";
import { actOnVerified } from "./plan-step-runner";
import { labelCandidates } from "./verify/element-labels";
import { inferRole } from "./verify/element-role";
import { relocateElementByPlan } from "./verify/relocate";

export interface DriftRepairResult {
  checked: number;
  repaired: number;
  /** Labels of answers the page took away and that could not be put back. */
  failed: string[];
}

function sameText(a: string, b: string): boolean {
  return (
    a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase()
  );
}

export async function repairDrift(since: number): Promise<DriftRepairResult> {
  const result: DriftRepairResult = { checked: 0, repaired: 0, failed: [] };
  for (const { el, step, shown } of plannedFillsSince(since)) {
    result.checked += 1;
    // A control the page remounted is found again by its label, never by a node id
    // from an earlier read.
    const live = el.isConnected
      ? { ok: true, element: el, matchedLabel: labelCandidates(el)[0], matchedRole: inferRole(el) }
      : relocateElementByPlan(step.expected_label, step.expected_role, step.value);
    if (!live.ok || !live.element) {
      result.failed.push(step.expected_label || step.action);
      continue;
    }
    if (controlAlreadyMatches(live.element, step.value).matched) continue;
    // Still showing what it showed when answered (a dropdown's picked option): the answer stands.
    if (shown && sameText(readControlValue(live.element), shown)) continue;
    traceFromPage("drift:repair", () => ({
      label: step.expected_label,
      before: readControlValue(live.element),
      connected: el.isConnected,
    }));
    const replayed = await actOnVerified({ ...step, force: true }, live);
    if (replayed.ok) result.repaired += 1;
    else result.failed.push(step.expected_label || step.action);
  }
  return result;
}
