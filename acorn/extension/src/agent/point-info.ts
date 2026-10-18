/**
 * What is under the pointer, for the run's log. A click that the screen shows did nothing is a
 * mystery without this: was it on the control, on something that covers it, or on a control that took
 * the click and did not change? The page answers with what it says of itself (tags, roles, states);
 * nothing here decides what a control is for.
 */

import type { Cdp } from "./cdp";

/** What the page says of the element at a point, and of the one that would take the click. */
export interface PointInfo {
  /** The element at the point, through shadow roots and same-origin frames. */
  tag: string;
  role?: string;
  type?: string;
  id?: string;
  /** The control the element belongs to when it is not the control itself (a label's input). */
  control?: { tag: string; type?: string; role?: string; checked?: boolean };
  checked?: boolean;
  ariaChecked?: string;
  ariaExpanded?: string;
  ariaDisabled?: string;
  disabled?: boolean;
  /** The element covers the control it seems to be over: a different element than the control's own. */
  coveredBy?: string;
  value?: string;
  /** Every element at the point, from the topmost down (at most a few): what a click went through. */
  stack?: string[];
  /** What has keyboard focus now. */
  active?: string;
}

/** The page-side function: a string, because the debugger runs it in the page. */
export const POINT_INFO_SCRIPT = (x: number, y: number): string => `((px, py) => {
  const clip = (t, n) => String(t == null ? "" : t).replace(/\\s+/g, " ").trim().slice(0, n || 60);
  let el = document.elementFromPoint(px, py);
  let ox = px, oy = py;
  for (let depth = 0; el && depth < 8; depth += 1) {
    if (el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(ox, oy);
      if (inner && inner !== el) { el = inner; continue; }
    }
    if (el.tagName === "IFRAME") {
      try {
        const inside = el.contentDocument;
        if (inside) {
          const box = el.getBoundingClientRect();
          ox -= box.left; oy -= box.top;
          const inner = inside.elementFromPoint(ox, oy);
          if (inner) { el = inner; continue; }
        }
      } catch (error) { break; }
    }
    break;
  }
  if (!el) return null;
  const describe = (node) => ({
    tag: node.tagName.toLowerCase(),
    type: node.type || undefined,
    role: node.getAttribute("role") || undefined,
    checked: typeof node.checked === "boolean" ? node.checked : undefined,
  });
  const info = Object.assign(describe(el), {
    id: el.id || undefined,
    ariaChecked: el.getAttribute("aria-checked") || undefined,
    ariaExpanded: el.getAttribute("aria-expanded") || undefined,
    ariaDisabled: el.getAttribute("aria-disabled") || undefined,
    disabled: el.disabled === true ? true : undefined,
    value: "value" in el && el.type !== "password" ? clip(el.value, 40) : undefined,
  });
  const name = (node) => node.tagName.toLowerCase() + (node.id ? "#" + node.id : "") + (node.getAttribute("role") ? "[role=" + node.getAttribute("role") + "]" : "");
  try { info.stack = document.elementsFromPoint(px, py).slice(0, 6).map(name); } catch (error) { /* a point outside the page */ }
  const active = document.activeElement;
  info.active = active ? name(active) : undefined;
  const labelled = el.closest && el.closest("label");
  const control = labelled && labelled.control ? labelled.control : null;
  if (control && control !== el) info.control = describe(control);
  const own = control || el;
  const box = own.getBoundingClientRect();
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  if (box.width > 0 && box.height > 0 && own.ownerDocument === document) {
    const top = document.elementFromPoint(cx, cy);
    if (top && top !== own && !own.contains(top) && !top.contains(own)) {
      info.coveredBy = top.tagName.toLowerCase() + (top.id ? "#" + top.id : "") + (top.getAttribute("role") ? "[role=" + top.getAttribute("role") + "]" : "");
    }
  }
  return info;
})(${Number(x)}, ${Number(y)})`;

/** What is at a point (CSS pixels of the page's viewport), or null when the page would not say. */
export async function readPointInfo(cdp: Cdp, x: number, y: number): Promise<PointInfo | null> {
  try {
    const answer = await cdp.send<{
      result?: { value?: PointInfo | null };
      exceptionDetails?: unknown;
    }>("Runtime.evaluate", { expression: POINT_INFO_SCRIPT(x, y), returnByValue: true });
    if (answer.exceptionDetails) return null;
    return answer.result?.value ?? null;
  } catch {
    return null;
  }
}

/** What is at a point, without the value of a field: the Logs tab holds labels and states, never what was typed. */
export function forLog(info: PointInfo | null): Omit<PointInfo, "value"> | null {
  if (!info) return null;
  const { value: _value, ...rest } = info;
  return rest;
}

/** The part of what is at a point that a click can change: a box's state, a list's value, a control's expansion. */
export function stateOf(info: PointInfo | null): string {
  if (!info) return "";
  return JSON.stringify([
    info.checked,
    info.control?.checked,
    info.ariaChecked,
    info.ariaExpanded,
    info.value,
  ]);
}

/** Whether the pointer was over a control whose state a click can change. */
export function hasState(info: PointInfo | null): boolean {
  if (!info) return false;
  const control = info.control ?? info;
  // Only a box or a radio button keeps a checked state a click changes; every input has the property.
  const togglesChecked = control.type === "checkbox" || control.type === "radio";
  return (
    (togglesChecked && typeof control.checked === "boolean") ||
    info.ariaChecked !== undefined ||
    info.ariaExpanded !== undefined ||
    info.tag === "select"
  );
}

/**
 * Page-side: focuses the form control under a point, or inside the label there, looking through
 * everything stacked at the point (a control a layer covers is still in the stack). It is a focus, as a
 * person tabbing to the field would give it; nothing is typed or clicked.
 */
export const FOCUS_CONTROL_SCRIPT = (x: number, y: number): string => `((px, py) => {
  const fillable = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), select:not([disabled]), [contenteditable=""], [contenteditable="true"]';
  const stack = document.elementsFromPoint ? document.elementsFromPoint(px, py) : [];
  for (const el of stack) {
    let control = el.matches && el.matches(fillable) ? el : null;
    if (!control && el.closest && el.closest("label") && el.closest("label").control && el.closest("label").control.matches(fillable)) control = el.closest("label").control;
    if (!control) continue;
    control.focus({ preventScroll: true });
    let now = document.activeElement;
    while (now && now.shadowRoot && now.shadowRoot.activeElement) now = now.shadowRoot.activeElement;
    return now === control;
  }
  return false;
})(${Number(x)}, ${Number(y)})`;

/** Focuses the form control at a point when a click there did not; true when a control now has focus. */
export async function focusControlAt(cdp: Cdp, x: number, y: number): Promise<boolean> {
  try {
    const answer = await cdp.send<{ result?: { value?: unknown }; exceptionDetails?: unknown }>(
      "Runtime.evaluate",
      { expression: FOCUS_CONTROL_SCRIPT(x, y), returnByValue: true },
    );
    return !answer.exceptionDetails && answer.result?.value === true;
  } catch {
    return false;
  }
}

/** The page's scroll position and the point to click once the target has been brought to mid-screen. */
export interface EdgeClick {
  x: number;
  y: number;
  scrollX: number;
  scrollY: number;
}

/**
 * Page-side: when a point is within `band` (a fraction of the window's height) of its top or bottom
 * edge, scrolls the element there to the middle of the window and says where the same spot of it now is,
 * and where the page was scrolled from. Null for a point away from the edges, or one over a frame.
 */
export const EDGE_CLICK_SCRIPT = (
  x: number,
  y: number,
  band: number,
): string => `((px, py, band) => {
  const height = window.innerHeight;
  if (!(py > height * (1 - band) || py < height * band)) return null;
  const el = document.elementFromPoint(px, py);
  if (!el || el.tagName === "IFRAME") return null;
  const before = el.getBoundingClientRect();
  const scrollX = window.scrollX, scrollY = window.scrollY;
  el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  if (Math.abs(window.scrollY - scrollY) < 1) return null;
  const after = el.getBoundingClientRect();
  return { x: after.left + (px - before.left), y: after.top + (py - before.top), scrollX, scrollY };
})(${Number(x)}, ${Number(y)}, ${Number(band)})`;

/** Brings a point near an edge to mid-screen, or null when it is not near one. */
export async function centerEdgeTarget(
  cdp: Cdp,
  x: number,
  y: number,
  band: number,
): Promise<EdgeClick | null> {
  try {
    const answer = await cdp.send<{
      result?: { value?: EdgeClick | null };
      exceptionDetails?: unknown;
    }>("Runtime.evaluate", { expression: EDGE_CLICK_SCRIPT(x, y, band), returnByValue: true });
    return answer.exceptionDetails ? null : (answer.result?.value ?? null);
  } catch {
    return null;
  }
}

/** Puts the page back where it was scrolled from, so the points of the actions that follow still hold. */
export async function restoreScroll(cdp: Cdp, scrollX: number, scrollY: number): Promise<void> {
  await cdp
    .send("Runtime.evaluate", {
      expression: `window.scrollTo({ left: ${Number(scrollX)}, top: ${Number(scrollY)}, behavior: "instant" })`,
    })
    .catch(() => undefined);
}
