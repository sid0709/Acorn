import { MSG } from "../../types";

/**
 * Type `text` into a field with the browser's own input events (see the background's
 * type-trusted handler): the field is focused and its content selected, so the typed text
 * replaces what it held. False when the browser would not (no debugger, DevTools open).
 */
export async function typeTrusted(
  field: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): Promise<boolean> {
  field.focus();
  field.select();
  try {
    const reply = await chrome.runtime.sendMessage({ type: MSG.TYPE_TRUSTED, text });
    return reply?.ok === true;
  } catch {
    return false;
  }
}
