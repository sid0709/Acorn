import { pointerActivate } from "../pointer-activate";
import { waitMs } from "../wait";
import { isDisplayed, ownedPopupOpen } from "./options-dom";
import { comboboxWidgetRoot } from "./widget-value";

/** Delay between keystrokes when appending a typed word. */
const SMOOTH_TYPE_DELAY_MS = 45;
/** Settle time after each typed word so filtered options can render. */
const WORD_SEARCH_SETTLE_MS = 320;
/** Time for a widget to close (or reopen on refocus) after a pick or a dismiss. */
const POPUP_SETTLE_MS = 120;
/** Legacy key code many widget libraries still read instead of `key`. */
const ESCAPE_KEY_CODE = 27;

function escapeKeydown(): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    keyCode: ESCAPE_KEY_CODE,
    which: ESCAPE_KEY_CODE,
    bubbles: true,
    cancelable: true,
  });
}

export function dismissOpenOverlays(doc: Document, control: HTMLElement): void {
  control.dispatchEvent(escapeKeydown());
  doc.dispatchEvent(escapeKeydown());
}

export type PopupCloseOutcome = "closed" | "escape" | "blur" | "still-open";

/**
 * A pick should leave the popup closed. Some widgets stay open, or reopen when focus
 * returns to them, until focus moves on. Escalate the way a person would: Escape,
 * then leave the field (Tab-like blur).
 */
export async function settlePopupClosed(
  control: HTMLElement,
  doc: Document,
): Promise<PopupCloseOutcome> {
  await waitMs(POPUP_SETTLE_MS);
  if (!ownedPopupOpen(control, doc)) return "closed";

  dismissOpenOverlays(doc, control);
  await waitMs(POPUP_SETTLE_MS);
  if (!ownedPopupOpen(control, doc)) return "escape";

  const widget = comboboxWidgetRoot(control);
  const active = doc.activeElement;
  if (active instanceof HTMLElement && (active === control || widget.contains(active))) {
    active.blur();
  }
  control.blur();
  await waitMs(POPUP_SETTLE_MS);
  return ownedPopupOpen(control, doc) ? "still-open" : "blur";
}

export async function focusAndOpenCombobox(el: HTMLElement): Promise<void> {
  el.scrollIntoView({ block: "center", behavior: "auto" });
  el.focus?.();
  pointerActivate(el);
  await waitMs(80);
  // Clear any leftover filter text so the full option list is visible.
  const input = resolveTypeableInput(el);
  if (input) {
    input.removeAttribute("aria-hidden");
    setInputValue(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await waitMs(60);
  }
}

export function resolveTypeableInput(
  el: HTMLElement,
): HTMLInputElement | HTMLTextAreaElement | null {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
  const root = el.parentElement || el;
  const candidates = Array.from(
    root.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea',
    ),
  ).filter((node): node is HTMLInputElement | HTMLTextAreaElement => {
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return false;
    const role = (node.getAttribute("role") || "").toLowerCase();
    return (
      role === "combobox" ||
      node.getAttribute("aria-autocomplete") === "list" ||
      node.type === "search" ||
      node.type === "text"
    );
  });
  return candidates.find((node) => isDisplayed(node as HTMLElement)) || candidates[0] || null;
}

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, text);
  else el.value = text;
}

export function typeaheadFilterWaitMs(doc: Document): number {
  return doc.hidden ? 8000 : 4000;
}

/** Type the full query string into an already-focused open combobox. */
export async function typeQueryIntoOpenCombobox(el: HTMLElement, query: string): Promise<void> {
  const input = resolveTypeableInput(el);
  if (!input) return;
  // Nested search inputs are often aria-hidden until the menu opens.
  input.removeAttribute("aria-hidden");
  input.focus();
  setInputValue(input, "");
  input.dispatchEvent(new Event("input", { bubbles: true }));

  let built = "";
  for (const ch of query) {
    built += ch;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true }));
    setInputValue(input, built);
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        data: ch,
        inputType: "insertText",
      }),
    );
    input.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true, cancelable: true }));
    await waitMs(SMOOTH_TYPE_DELAY_MS);
  }
  await waitMs(WORD_SEARCH_SETTLE_MS);
}
