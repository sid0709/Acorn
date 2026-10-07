/** ARIA roles whose accessible name is the option label, not a filled value. */
const CHOICE_ROLES = ["option", "radio", "checkbox", "switch"] as const;

const ARIA_TRUE = "true";

function choiceRole(el: Element): string {
  return ((el as HTMLElement).getAttribute?.("role") || "").toLowerCase();
}

/**
 * Widgets that always expose their own option label in text.
 * A label match is only a filled answer when the widget is selected.
 */
export function isChoiceWidget(el: Element): boolean {
  if (el instanceof HTMLOptionElement || el instanceof HTMLButtonElement) return true;
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    return true;
  }
  const role = choiceRole(el);
  return (CHOICE_ROLES as readonly string[]).includes(role);
}

/** How an element looks, as far as "is it the chosen one" shows: colours and weight. */
export function choiceLook(el: Element): string {
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  if (!style) return "";
  return [style.backgroundColor, style.borderColor, style.color, style.fontWeight].join("|");
}

/** How each option looked right before this page's first click on it. */
const lookBeforeClick = new WeakMap<Element, string>();

/** Called before a click on an option: keeps how it looked while not chosen. */
export function rememberLookBeforeClick(el: Element): void {
  if (!lookBeforeClick.has(el)) lookBeforeClick.set(el, choiceLook(el));
}

/**
 * Where an option's chosen state lives: its own native or ARIA state, the control
 * its <label> names, or a native box inside it. Null when none of those carries it
 * (a styled button), so the caller cannot mistake "unknown" for "not chosen".
 */
function readableState(el: Element): boolean | null {
  if (el instanceof HTMLOptionElement) return el.selected;
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    return el.checked;
  }
  const html = el as HTMLElement;
  for (const attr of ["aria-selected", "aria-checked", "aria-pressed"]) {
    const value = html.getAttribute?.(attr);
    if (value === ARIA_TRUE) return true;
    if (value === "false") return false;
  }
  if (el instanceof HTMLLabelElement && el.control) return readableState(el.control);
  const inner = el.querySelector?.('input[type="checkbox"], input[type="radio"]');
  return inner ? readableState(inner) : null;
}

/**
 * Whether an option is chosen: its readable state, else — for an option this run
 * clicked — whether it no longer looks the way it did before that click. Null when
 * nothing tells.
 */
export function choiceState(el: Element): boolean | null {
  const readable = readableState(el);
  if (readable != null) return readable;
  const before = lookBeforeClick.get(el);
  return before == null ? null : choiceLook(el) !== before;
}

/** Chosen for sure; unknown counts as not chosen for reading a value. */
export function isChoiceSelected(el: Element): boolean {
  return choiceState(el) === true;
}
