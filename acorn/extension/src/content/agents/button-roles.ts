import { isA } from "../realm";
/**
 * Buttons that answer and buttons that act. An answer is one of a few peers (Yes /
 * No, a title, a degree): the applicant picks one and the form keeps its shape. A
 * command does something to the form instead: it adds, opens, saves, cancels,
 * edits, or removes. They are told apart by structure alone — what the buttons
 * are, how they are drawn beside each other, and what pressing one did — never by
 * their wording.
 */

/** Attributes that hold an option's chosen state: a control carrying one is an option. */
const CHOICE_STATE_ATTRS = ["aria-pressed", "aria-checked", "aria-selected"] as const;
/** Roles that make a control one option of an answer. */
const CHOICE_ROLES = new Set([
  "radio",
  "checkbox",
  "switch",
  "option",
  "menuitemradio",
  "menuitemcheckbox",
]);

/** How buttons are drawn when pressing one acted on the form, on this page. */
const commandLooks = new Set<string>();

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function roleOf(el: Element): string {
  return (el.getAttribute("role") || "").toLowerCase();
}

/** The control carries a chosen state of its own (a native box, ARIA): an option by definition. */
export function holdsChoiceState(el: Element): boolean {
  if (isA(el, HTMLInputElement) && (el.type === "radio" || el.type === "checkbox")) {
    return true;
  }
  if (CHOICE_ROLES.has(roleOf(el))) return true;
  return CHOICE_STATE_ATTRS.some((attr) => el.hasAttribute(attr));
}

/** A plain button: it shows no state of its own, so only a press says what it does. */
export function isStatelessButton(el: Element): boolean {
  const plain = isA(el, HTMLButtonElement) || roleOf(el) === "button";
  return plain && !holdsChoiceState(el);
}

/** How a button is drawn beside its peers: what it is and its classes, never its words. */
export function buttonLook(el: Element): string {
  const classes = Array.from(el.classList).sort().join(".");
  return [el.tagName.toLowerCase(), el.getAttribute("type") ?? "", roleOf(el), classes].join("|");
}

/** The words a person reads on the button itself; an icon button has none of its own. */
function ownWords(el: HTMLElement): string {
  return normalize(el.innerText || "");
}

/**
 * Whether a few plain buttons can be one question's answers: each carries words
 * of its own, no two say the same, and all are drawn alike. Icon buttons (they act
 * on the entry beside them), a label repeated per entry (each entry's own remove),
 * and buttons drawn apart (a cancel beside a save) act on the form instead. A
 * group whose answer is already chosen draws that one apart: it needs no answer.
 */
export function looksLikeAnswers(buttons: HTMLElement[]): boolean {
  if (buttons.length < 2 || buttons.some(isKnownCommand)) return false;
  const words = buttons.map(ownWords);
  if (words.some((text) => !text) || new Set(words).size !== words.length) return false;
  return new Set(buttons.map(buttonLook)).size === 1;
}

/** A button pressed as an answer acted on the form: buttons drawn like it never answer here. */
export function rememberCommand(el: Element): void {
  commandLooks.add(buttonLook(el));
}

/** Buttons drawn like one that acted on the form when it was pressed as an answer. */
export function isKnownCommand(el: Element): boolean {
  return commandLooks.has(buttonLook(el));
}
