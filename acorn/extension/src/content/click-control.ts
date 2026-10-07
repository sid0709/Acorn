import { pointerActivate } from "./agents/pointer-activate";
import { resolveElementByNodeId } from "./element-resolver";

/** The click lands after the reply, so a click that navigates cannot swallow the answer. */
export const CLICK_AFTER_REPLY_MS = 60;

export interface ClickControlResult {
  ok: boolean;
  error?: string;
  /** What was clicked, for the run log. */
  tag?: string;
  text?: string;
  /** The control exists but refuses clicks: the page is waiting on something. */
  disabled?: boolean;
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
  if (isDisabled(el)) {
    return { ok: false, error: "Control is disabled", disabled: true, ...found };
  }
  schedule(() => pointerActivate(el));
  return { ok: true, ...found };
}
