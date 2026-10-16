/**
 * Keys and typed text go to whatever has focus. When nothing does (the page itself), a space, an
 * arrow, Home or PageDown scrolls the page instead, and typed words scroll it too: the page moves
 * under points the model measured on an earlier screenshot, and the next clicks land on other
 * controls. An action that would do that is refused, so the model looks again and clicks the
 * control first.
 */

import type { Cdp } from "./cdp";

/** Keys that scroll a page that has nothing focused (a space scrolls it down). */
export const PAGE_SCROLLING_KEYS: ReadonlySet<string> = new Set([
  "arrowup",
  "arrowdown",
  "pageup",
  "pagedown",
  "home",
  "end",
  "space",
  " ",
]);

/** Whether a key or a chord ("Control+a", "ArrowDown ArrowDown") holds a key that scrolls a page. */
export function scrollsAPage(keys: string): boolean {
  return keys
    .split(/\s+/)
    .filter(Boolean)
    .some((chord) => PAGE_SCROLLING_KEYS.has((chord.split("+").pop() ?? "").toLowerCase()));
}

/**
 * Whether no control has focus, so the page itself would take a key. A page that cannot be asked
 * (it is navigating, or answers nothing) is not refused: the action goes ahead as before.
 */
export async function nothingHasFocus(cdp: Cdp): Promise<boolean> {
  try {
    const answer = await cdp.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      expression: `(() => {
        let el = document.activeElement;
        while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
        return !el || el === document.body || el === document.documentElement;
      })()`,
      returnByValue: true,
    });
    return answer.result?.value === true;
  } catch {
    return false;
  }
}

/** The error that says why such an action was not done. */
export const NO_FOCUS_MESSAGE =
  "nothing has focus, so this would scroll the page instead of reaching a control: click the control first";
