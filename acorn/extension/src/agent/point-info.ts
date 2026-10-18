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
