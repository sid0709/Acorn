/** Capture snapshots of form controls and pages, built only when a trace is sent (ACORN_CAPTURE). */
import { shownValue } from "@acorn/shared/secret-value";

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

/** Password boxes: their values never leave the page, in any capture. */
const SECRET_INPUT_SELECTOR = 'input[type="password" i]';

/**
 * An element's HTML for capture, with every password box's value attribute
 * removed (a framework may mirror the typed value into the attribute).
 */
export function redactedHtml(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  const secrets = copy.matches(SECRET_INPUT_SELECTOR)
    ? [copy, ...copy.querySelectorAll(SECRET_INPUT_SELECTOR)]
    : Array.from(copy.querySelectorAll(SECRET_INPUT_SELECTOR));
  for (const input of secrets) input.removeAttribute("value");
  return copy.outerHTML;
}

/** This frame's whole page for capture: passwords removed, cut at max characters. */
export function capturedPageHtml(max: number): string {
  return redactedHtml(document.documentElement).slice(0, max);
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
    rootHtml: redactedHtml(root).replace(/\s+/g, " ").slice(0, 1500),
    parts: readWidgetTextParts(el),
    read: readControlValue(el),
  };
}

/** Every visible combobox / select with its current read value. */
export function comboSnapshot(): Array<Record<string, unknown>> {
  return deepQueryAll(document, '[role="combobox"], select')
    .filter((el) => el.getClientRects().length > 0 || el instanceof HTMLSelectElement)
    .slice(0, 30)
    .map((el) => ({
      id: (el as HTMLElement).id || undefined,
      label: labelOf(el) || undefined,
      read: readControlValue(el),
    }));
}
