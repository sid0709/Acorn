/**
 * Capture snapshots of form controls, built only when a trace is sent (ACORN_CAPTURE).
 * They describe controls by tag, role, label and shown value; no page HTML leaves the page.
 */
import { shownValue } from "@acorn/shared/secret-value";

import { DROPDOWN_SELECTOR } from "./agents/combobox/popup-roles";
import { comboboxWidgetRoot, readWidgetTextParts } from "./agents/combobox/widget-value";
import { readControlValue } from "./agents/read-control-value";
import { deepQueryAll } from "./shadow-control";

function labelOf(el: Element): string {
  const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  const byIds = ids
    .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim())
    .filter(Boolean)
    .join(" ");
  if (byIds) return byIds.slice(0, 80);
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.slice(0, 80);
  if (el.id) {
    const forLabel = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (forLabel?.textContent) return forLabel.textContent.trim().slice(0, 80);
  }
  return "";
}

export function describeEl(el: Element | null): Record<string, unknown> | null {
  if (!el) return null;
  const h = el as HTMLElement;
  return {
    tag: el.tagName.toLowerCase(),
    id: h.id || undefined,
    name: h.getAttribute("name") || undefined,
    type: h.getAttribute("type") || undefined,
    role: h.getAttribute("role") || undefined,
    cls: String(h.className || "").slice(0, 80) || undefined,
    label: labelOf(el) || undefined,
    inputValue: el instanceof HTMLInputElement ? shownValue(el, el.value) : undefined,
    rendered: el.getClientRects().length > 0,
  };
}

export function describeWidget(el: Element): Record<string, unknown> {
  const root = comboboxWidgetRoot(el);
  return {
    root: describeEl(root),
    parts: readWidgetTextParts(el),
    read: readControlValue(el),
  };
}

/** Every visible combobox / select with its current read value. */
export function comboSnapshot(): Array<Record<string, unknown>> {
  return deepQueryAll(document, DROPDOWN_SELECTOR)
    .filter((el) => el.getClientRects().length > 0 || el instanceof HTMLSelectElement)
    .slice(0, 30)
    .map((el) => ({
      id: (el as HTMLElement).id || undefined,
      label: labelOf(el) || undefined,
      read: readControlValue(el),
    }));
}
