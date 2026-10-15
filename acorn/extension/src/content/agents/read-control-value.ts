import { isA } from "../realm";

import { isChoiceSelected, isChoiceWidget } from "./choice-state";
import { comboboxWidgetRoot, readWidgetTextParts } from "./combobox/widget-value";
import { isSearchBox } from "./field-focus";
import { isBlankOption } from "./native-select";

const PLACEHOLDER_VALUES = new Set(["", "select...", "select", "choose...", "choose"]);

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Linguistic empty-state labels (not vendor-specific strings). */
function isPlaceholder(text: string): boolean {
  const n = normalize(text);
  if (PLACEHOLDER_VALUES.has(n)) return true;
  const stripped = n.replace(/^[—\-–•·.|]+|[—\-–•·.|]+$/g, "").trim();
  if (!stripped) return true;
  return /^(select(\s|$)|choose(\s|$)|pick(\s|$)|make a selection|type to search|please select)/i.test(
    stripped,
  );
}

/**
 * Enhanced dropdowns often keep the chosen label in a sibling node while the
 * combobox <input> stays empty. Read the widget box structurally (no vendor classes).
 */
function readComboboxDisplayValue(el: Element): string {
  const html = el as HTMLElement;
  const hint = normalize(
    html.getAttribute("placeholder") || html.getAttribute("aria-placeholder") || "",
  );
  const parts = readWidgetTextParts(el).filter(
    (text) => !isPlaceholder(text) && normalize(text) !== hint,
  );
  if (parts.length) return parts.join(", ");

  const aria = html.getAttribute("aria-valuetext") || html.getAttribute("data-value");
  if (aria && !isPlaceholder(aria)) return aria.trim();

  return "";
}

function isComboboxControl(el: HTMLElement): boolean {
  const role = (el.getAttribute("role") || "").toLowerCase();
  return (
    role === "combobox" ||
    el.getAttribute("aria-haspopup") === "listbox" ||
    el.getAttribute("aria-haspopup") === "true" ||
    el.getAttribute("aria-autocomplete") === "list" ||
    (el.hasAttribute("aria-expanded") && el.hasAttribute("aria-controls"))
  );
}

/** Read the user-visible value of a form control for validate / reporting. */
/** The options listed inside the field itself: the items a search box has picked. */
function pickedInField(el: HTMLElement): string {
  const field = comboboxWidgetRoot(el);
  return Array.from(field.querySelectorAll('[role="option"]'))
    .map((option) => (option.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ");
}

export function readControlValue(el: Element | null): string {
  if (!el) return "";

  if (isA(el, HTMLInputElement)) {
    if (el.type === "checkbox" || el.type === "radio") return String(el.checked);
    if (el.type === "file") {
      return Array.from(el.files ?? [])
        .map((f) => f.name)
        .join(", ");
    }

    if (isComboboxControl(el)) {
      const displayed = readComboboxDisplayValue(el);
      if (displayed) return displayed;
    }

    // A search box's answer is what was picked from its results, listed inside
    // its own field; the box itself is empty once a pick is made.
    if (!el.value && isSearchBox(el)) return pickedInField(el);

    return el.value;
  }

  if (isA(el, HTMLSelectElement)) {
    const selected = el.selectedOptions?.[0];
    // The blank choice is no answer, whatever value it carries.
    if (selected && isBlankOption(selected)) return "";
    const label = (selected?.textContent || selected?.label || el.value || "").trim();
    if (label && !isPlaceholder(label)) return label;

    // Enhanced selects often leave the native control empty while the widget shows the value.
    const parent = el.parentElement;
    if (parent) {
      const combo = parent.querySelector('[role="combobox"]');
      if (combo) {
        const displayed = readComboboxDisplayValue(combo);
        if (displayed) return displayed;
      }
    }
    return "";
  }

  if (isA(el, HTMLTextAreaElement)) return el.value;

  const role = ((el as HTMLElement).getAttribute("role") || "").toLowerCase();
  if (role === "option" || isA(el, HTMLOptionElement)) {
    const selected = isA(el, HTMLOptionElement)
      ? el.selected
      : (el as HTMLElement).getAttribute("aria-selected") === "true";
    if (!selected) return "";
    const text = (
      (el as HTMLElement).getAttribute("aria-label") ||
      (isA(el, HTMLOptionElement) ? el.label || el.text : "") ||
      (el as HTMLElement).innerText ||
      (el as HTMLElement).textContent ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
    return isPlaceholder(text) ? "" : text;
  }

  if (isComboboxControl(el as HTMLElement)) {
    const displayed = readComboboxDisplayValue(el);
    if (displayed) return displayed;
  }

  // Choice widgets always contain their option label; that is not a filled value
  // unless the control is actually selected.
  if (isChoiceWidget(el) && !isChoiceSelected(el)) return "";

  const text = ((el as HTMLElement).innerText || el.textContent || "").trim();
  return isPlaceholder(text) ? "" : text;
}
