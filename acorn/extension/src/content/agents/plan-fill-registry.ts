import { comboboxWidgetRoot } from "./combobox/widget-value";

/** Widget boxes a plan step already filled (or found filled), so later passes leave them alone. */

const filledWidgets = new Set<Element>();

export function rememberPlanFilled(el: Element): void {
  for (const widget of filledWidgets) {
    if (!widget.isConnected) filledWidgets.delete(widget);
  }
  filledWidgets.add(comboboxWidgetRoot(el));
}

export function wasPlanFilled(el: Element): boolean {
  const widget = comboboxWidgetRoot(el);
  for (const filled of filledWidgets) {
    if (!filled.isConnected) continue;
    if (filled === widget || filled.contains(widget) || widget.contains(filled)) return true;
  }
  return false;
}
