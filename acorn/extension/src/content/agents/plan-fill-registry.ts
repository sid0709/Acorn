import { comboboxWidgetRoot } from "./combobox/widget-value";

import type { PlanStepPayload } from "../../types";

/** Widget boxes a plan step already filled (or found filled), so later passes leave them alone. */

/** Steps a page can undo afterwards (an import, a reset): typed and picked answers, never uploads. */
const REPAIRABLE_ACTIONS = new Set<PlanStepPayload["action"]>(["fill", "select_radio"]);

/** The step that answered a widget, kept so a page that clears it can get it back. */
export interface PlannedFill {
  el: Element;
  step: PlanStepPayload;
  /** When the step ran (ms since epoch); a repair only replays steps from its own fill. */
  at: number;
  /**
   * What the control showed right after the step answered it. A dropdown shows the
   * option it picked, not the planned words; the answer stands while it shows this.
   */
  shown: string;
}

const filledWidgets = new Set<Element>();
const plannedFills = new Map<Element, PlannedFill>();

export function rememberPlanFilled(el: Element, step?: PlanStepPayload, shown = ""): void {
  for (const widget of filledWidgets) {
    if (!widget.isConnected) filledWidgets.delete(widget);
  }
  const widget = comboboxWidgetRoot(el);
  filledWidgets.add(widget);
  if (step && REPAIRABLE_ACTIONS.has(step.action) && step.value != null) {
    // The newest answer wins: a Refill's corrected value replaces the first one.
    plannedFills.set(widget, { el, step: { ...step, file: undefined }, at: Date.now(), shown });
  }
}

export function wasPlanFilled(el: Element): boolean {
  const widget = comboboxWidgetRoot(el);
  for (const filled of filledWidgets) {
    if (!filled.isConnected) continue;
    if (filled === widget || filled.contains(widget) || widget.contains(filled)) return true;
  }
  return false;
}

/** Answers recorded since `since`, oldest first. Older ones belong to an earlier page. */
export function plannedFillsSince(since: number): PlannedFill[] {
  for (const [widget, fill] of plannedFills) {
    if (fill.at < since) plannedFills.delete(widget);
  }
  return [...plannedFills.values()].sort((a, b) => a.at - b.at);
}
