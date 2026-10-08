/**
 * Enter and leave a field the way a person does. Many forms only take a typed
 * value when the field loses focus (their required check runs then), and listen
 * for focusin / focusout, not a bare blur. A run usually works in a tab without
 * window focus, where focus() and blur() fire no events, so the events are sent
 * by hand there.
 */

/** Put the field in focus, with the events a framework listens for. */
export function enterField(el: HTMLElement): void {
  const doc = el.ownerDocument;
  el.focus();
  if (doc.hasFocus() && doc.activeElement === el) return;
  el.dispatchEvent(new FocusEvent("focus"));
  el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

/** Leave the field, so the page commits and checks what was typed. */
export function leaveField(el: HTMLElement): void {
  const doc = el.ownerDocument;
  if (doc.hasFocus() && doc.activeElement === el) {
    el.blur();
    return;
  }
  el.dispatchEvent(new FocusEvent("blur"));
  el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

/**
 * A text box that declares typing as a search whose results are then picked
 * (standard attributes only): Enter runs the search; the typed words are not the
 * answer until an option is chosen.
 */
export function isSearchBox(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if ((el.getAttribute("role") || "").toLowerCase() === "searchbox") return true;
  if ((el.getAttribute("enterkeyhint") || "").toLowerCase() === "search") return true;
  return el instanceof HTMLInputElement && el.type.toLowerCase() === "search";
}

/** Press Enter in the field, as a person does to run its search. */
export function pressEnter(el: HTMLElement): void {
  const init = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  };
  el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keypress", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
}
