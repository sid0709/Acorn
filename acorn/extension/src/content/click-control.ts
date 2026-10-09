import { pointerActivate } from "./agents/pointer-activate";
import { resolveElementByNodeId } from "./element-resolver";
import { shadowDelegate } from "./shadow-control";

/** The click lands after the reply, so a click that navigates cannot swallow the answer. */
export const CLICK_AFTER_REPLY_MS = 60;
/**
 * How much bigger than the control an element on top of it may be and still take
 * its click. A click-catching layer sits right over its control; a backdrop that
 * covers the page is far bigger and is never clicked in the control's place.
 */
const OVERLAY_MAX_AREA_RATIO = 4;

export interface ClickControlResult {
  ok: boolean;
  error?: string;
  /** What was clicked, for the run log. */
  tag?: string;
  text?: string;
  /** The control exists but refuses clicks: the page is waiting on something. */
  disabled?: boolean;
}

/**
 * Where a person's click on the control lands: the element on top at its centre.
 * Some sites lay a transparent layer over a button and listen there, so a click
 * sent to the button itself never reaches them. Only a layer about the control's
 * own size takes the click; anything else (the control, its text, a backdrop) leaves it on the control.
 */
function clickTarget(el: HTMLElement): HTMLElement {
  el.scrollIntoView({ block: "center", behavior: "auto" });
  const box = el.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return el;
  const root = el.getRootNode() as Document | ShadowRoot;
  const top = root.elementFromPoint?.(box.left + box.width / 2, box.top + box.height / 2);
  if (!(top instanceof HTMLElement) || top === el || el.contains(top) || top.contains(el)) {
    return el;
  }
  const layer = top.getBoundingClientRect();
  const fits = layer.width * layer.height <= box.width * box.height * OVERLAY_MAX_AREA_RATIO;
  return fits ? top : el;
}

function isDisabled(el: HTMLElement): boolean {
  return (
    (el as HTMLButtonElement).disabled === true ||
    el.getAttribute("aria-disabled") === "true" ||
    el.hasAttribute("disabled")
  );
}

/**
 * Press one control the run picked from the tree. Returns what it found; the click
 * itself is scheduled by `schedule` after the reply is sent.
 */
export function prepareControlClick(
  nodeId: number,
  schedule: (click: () => void) => void,
): ClickControlResult {
  const el = resolveElementByNodeId(nodeId);
  if (!(el instanceof HTMLElement)) {
    return { ok: false, error: "Control not found on the page" };
  }
  const text = (el.innerText || el.textContent || el.getAttribute("aria-label") || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const found = { tag: el.tagName.toLowerCase(), text };
  // A custom element wrapping a native control: a person's click lands on the one
  // inside, and bubbles out to the element's own listeners.
  const delegate = shadowDelegate(el);
  if (isDisabled(el) || (delegate != null && isDisabled(delegate))) {
    return { ok: false, error: "Control is disabled", disabled: true, ...found };
  }
  schedule(() => pointerActivate(delegate ?? clickTarget(el)));
  return { ok: true, ...found };
}
