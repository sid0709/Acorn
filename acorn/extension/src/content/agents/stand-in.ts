import { isDisplayed } from "./combobox/options-dom";
import { POPUP_OWNER_SELECTOR } from "./combobox/popup-roles";
import { comboboxWidgetRoot } from "./combobox/widget-value";

/**
 * The control a person would use for a field when a step names one nobody can
 * see: many dropdowns keep an invisible input beside the visible button that
 * opens their list. When the field holds exactly one visible control that opens
 * a list, the step acts on it; otherwise on the element it named.
 */
export function visibleStandIn(el: Element): Element {
  if (!(el instanceof HTMLElement) || isDisplayed(el)) return el;
  const field = comboboxWidgetRoot(el);
  const owners = Array.from(field.querySelectorAll(POPUP_OWNER_SELECTOR)).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && node !== el && isDisplayed(node),
  );
  return owners.length === 1 ? owners[0] : el;
}

/** A control that opens a list of options (a dropdown, a select, a search box). */
export function opensOptionList(el: Element): boolean {
  return el.matches(POPUP_OWNER_SELECTOR);
}
