import { setNativeValue } from "./fill";

/** Input types that hold typed text; choice, file, and button inputs are never cleared. */
const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "tel",
  "url",
  "number",
  "password",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
]);

/**
 * Empty a typed field (Refill: an optional field the page rejected and the
 * profile has no value for). Returns the value left behind.
 */
export async function clearElement(el: Element): Promise<string> {
  const html = el as HTMLElement;
  html.scrollIntoView({ block: "center", behavior: "auto" });

  if (el instanceof HTMLTextAreaElement) {
    await setNativeValue(el, "");
    return el.value;
  }
  if (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has((el.type || "text").toLowerCase())) {
    await setNativeValue(el, "");
    return el.value;
  }
  if (html.isContentEditable) {
    html.focus();
    html.textContent = "";
    html.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContent" }));
    html.dispatchEvent(new Event("blur", { bubbles: true }));
    return html.textContent || "";
  }
  throw new Error(`clear only applies to text fields, not <${el.tagName.toLowerCase()}>`);
}
