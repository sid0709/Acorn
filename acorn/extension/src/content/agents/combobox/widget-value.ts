import { looksLikePlaceholderInk } from "./text-contrast";

/**
 * Structural read of what an enhanced dropdown shows as its value.
 *
 * Many widgets keep the chosen label in a sibling node while the combobox <input>
 * stays empty. Instead of matching vendor class names, climb to the smallest
 * ancestor that holds only this one control, then read its visible text minus the
 * popup, labels, buttons, live regions, visually-hidden helpers, faded placeholder
 * ink, and anything off the control's row (stacked labels above, help or error text below).
 */

/** Ancestors climbed from the control before giving up on finding its widget box. */
const WIDGET_ROOT_MAX_DEPTH = 6;
/** Text boxes this small are screen-reader-only helpers, not the visible value. */
const VISUALLY_HIDDEN_MAX_PX = 1;
/** Slack when checking that value text sits on the control's own row. */
const VALUE_ROW_TOLERANCE_PX = 4;

const FIELD_CONTROL_SELECTOR = [
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "[role='combobox']",
  "[role='textbox']",
  "[contenteditable='']",
  "[contenteditable='true']",
].join(", ");

/** Nodes that name or describe the field rather than hold its value. */
const FIELD_CAPTION_SELECTOR = "label, legend, h1, h2, h3, h4, h5, h6";

/** Popup / announcement roles whose text is never the selected value. */
const NON_VALUE_ROLES = new Set([
  "listbox",
  "option",
  "menu",
  "menuitem",
  "dialog",
  "tooltip",
  "alert",
  "status",
  "log",
]);

function isRendered(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return !style || (style.visibility !== "hidden" && style.display !== "none");
}

function idRefs(el: Element, attr: string): Element[] {
  const doc = el.ownerDocument;
  return (el.getAttribute(attr) || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => doc.getElementById(id))
    .filter((node): node is HTMLElement => node != null);
}

/** Another visible form control inside `node` that is not part of `control`. */
function holdsForeignControl(node: Element, control: Element): boolean {
  for (const other of Array.from(node.querySelectorAll(FIELD_CONTROL_SELECTOR))) {
    if (other === control || other.contains(control) || control.contains(other)) continue;
    if (!isRendered(other)) continue;
    return true;
  }
  return false;
}

/** Smallest ancestor box that belongs to `control` alone (its widget chrome). */
export function comboboxWidgetRoot(control: Element): Element {
  const labels = idRefs(control, "aria-labelledby");
  let root: Element = control;
  let node = control.parentElement;
  for (let depth = 0; node && depth < WIDGET_ROOT_MAX_DEPTH; depth += 1) {
    if (node === node.ownerDocument.body || node.tagName === "FORM") break;
    if (node.querySelector(FIELD_CAPTION_SELECTOR)) break;
    if (labels.some((label) => node!.contains(label))) break;
    if (holdsForeignControl(node, control)) break;
    root = node;
    node = node.parentElement;
  }
  return root;
}

function isValueTextHost(el: Element, control: Element, excluded: Element[]): boolean {
  if (excluded.some((skip) => skip === el)) return false;
  if (el instanceof HTMLSelectElement || el instanceof HTMLTemplateElement) return false;
  if (el.matches(FIELD_CAPTION_SELECTOR)) return false;
  if (el.hasAttribute("aria-live")) return false;
  const role = (el.getAttribute("role") || "").toLowerCase();
  if (NON_VALUE_ROLES.has(role)) return false;
  // Clear / toggle buttons beside the value; a button that *is* the control keeps its text.
  const isButton = el instanceof HTMLButtonElement || role === "button";
  if (isButton && el !== control && !el.contains(control)) return false;
  if (!isRendered(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= VISUALLY_HIDDEN_MAX_PX && rect.height <= VISUALLY_HIDDEN_MAX_PX) return false;
  return true;
}

/**
 * Visible text the widget box renders for `control`, deduplicated in DOM order.
 * Callers decide which parts are placeholders.
 */
export function readWidgetTextParts(control: Element): string[] {
  const root = comboboxWidgetRoot(control);
  const excluded = [
    ...idRefs(control, "aria-controls"),
    ...idRefs(control, "aria-owns"),
    ...idRefs(control, "aria-labelledby"),
  ];
  const verdicts = new Map<Element, boolean>();
  const hostAllows = (el: Element): boolean => {
    const cached = verdicts.get(el);
    if (cached != null) return cached;
    const parent = el === root ? null : el.parentElement;
    const allowed =
      isValueTextHost(el, control, excluded) && (parent == null || hostAllows(parent));
    verdicts.set(el, allowed);
    return allowed;
  };

  const row = control.getBoundingClientRect();
  const onControlRow = (host: Element): boolean => {
    if (row.height === 0) return true;
    const rect = host.getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    return (
      middle >= row.top - VALUE_ROW_TOLERANCE_PX && middle <= row.bottom + VALUE_ROW_TOLERANCE_PX
    );
  };

  const parts: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const value = (text.textContent || "").replace(/\s+/g, " ").trim();
    // Icons and glyphs (×, ▾) are chrome; a value has a letter or digit.
    if (!/[\p{L}\p{N}]/u.test(value) || parts.includes(value)) continue;
    const host = text.parentElement;
    if (!host || !hostAllows(host) || !onControlRow(host)) continue;
    if (looksLikePlaceholderInk(host, control)) continue;
    parts.push(value);
  }
  return parts;
}
