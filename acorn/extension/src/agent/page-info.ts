/**
 * What a screenshot cannot show: the control that has keyboard focus, with its value, its
 * label, its options, and what the page says is wrong with it. The page answers; nothing
 * here decides what the control is for.
 */

import type { Cdp } from "./cdp";
import type { AgentFocus } from "@acorn/shared/agent-contract";

/** The most options of a native list that are reported. */
export const FOCUS_OPTIONS_MAX = 80;
/** The longest value, label, or message that is reported. */
export const FOCUS_TEXT_MAX_CHARS = 200;

/** The most characters of a page's text that are sent, so a long page stays one request. */
export const PAGE_TEXT_MAX_CHARS = 24_000;

/** Runs in the page: its visible text. A screenshot may never show a job description that sits above the form. */
export const PAGE_TEXT_SCRIPT = `(() => {
  const body = document.body;
  return body ? String(body.innerText || "").slice(0, ${PAGE_TEXT_MAX_CHARS}) : "";
})()`;

/** The page's visible text, or "" when the page has none or cannot be read. */
export async function readPageText(cdp: Cdp): Promise<string> {
  try {
    const answer = await cdp.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      expression: PAGE_TEXT_SCRIPT,
      returnByValue: true,
    });
    const value = answer.result?.value;
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

/**
 * The page-side function. It runs in the page, so it is a string: it reads the focused
 * control, looking through shadow roots and same-origin frames, and hides what a password
 * field holds.
 */
export const FOCUS_SCRIPT = `(() => {
  const MAX = ${FOCUS_TEXT_MAX_CHARS};
  const OPTIONS_MAX = ${FOCUS_OPTIONS_MAX};
  const clip = (text) => String(text ?? "").replace(/\\s+/g, " ").trim().slice(0, MAX);
  let el = document.activeElement;
  for (let depth = 0; el && depth < 8; depth += 1) {
    if (el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    else if (el.tagName === "IFRAME") {
      try {
        const inner = el.contentDocument && el.contentDocument.activeElement;
        if (!inner || inner === el.contentDocument.body) break;
        el = inner;
      } catch (error) {
        break;
      }
    } else break;
  }
  if (!el || el === document.body || el === document.documentElement) return null;
  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute("type") || "";
  const labelledBy = (el.getAttribute("aria-labelledby") || "")
    .split(/\\s+/)
    .map((id) => (el.ownerDocument.getElementById(id) || {}).textContent)
    .filter(Boolean)
    .join(" ");
  const label = clip(
    el.getAttribute("aria-label") ||
      labelledBy ||
      (el.labels && el.labels[0] && el.labels[0].textContent) ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      ""
  );
  const out = { tag, label };
  if (type) out.type = type;
  if (tag === "select") {
    out.options = Array.from(el.options).slice(0, OPTIONS_MAX).map((o) => clip(o.text));
    out.multiple = el.multiple;
    out.value = Array.from(el.selectedOptions).map((o) => clip(o.text)).join(", ");
  } else if (tag === "input" || tag === "textarea") {
    const value = el.value || "";
    out.value = type === "password" ? (value ? "(" + value.length + " characters, hidden)" : "") : clip(value);
    if (type === "checkbox" || type === "radio") out.checked = el.checked;
  } else if (el.isContentEditable) {
    out.value = clip(el.textContent);
  } else if (el.getAttribute("role") === "combobox") {
    out.value = clip(el.value || el.textContent);
  }
  if (el.required || el.getAttribute("aria-required") === "true") out.required = true;
  if (el.validity && !el.validity.valid) out.invalid = clip(el.validationMessage);
  else if (el.getAttribute("aria-invalid") === "true") {
    const messageId = el.getAttribute("aria-errormessage");
    const message = messageId && el.ownerDocument.getElementById(messageId);
    out.invalid = clip(message ? message.textContent : "marked invalid");
  }
  return out;
})()`;

type EvaluateResult = { result?: { value?: AgentFocus | null }; exceptionDetails?: unknown };

/** The focused control, or null when nothing has focus or the page would not say. */
export async function readFocus(cdp: Cdp): Promise<AgentFocus | null> {
  try {
    const answer = await cdp.send<EvaluateResult>("Runtime.evaluate", {
      expression: FOCUS_SCRIPT,
      returnByValue: true,
    });
    if (answer.exceptionDetails) return null;
    return answer.result?.value ?? null;
  } catch {
    return null;
  }
}
