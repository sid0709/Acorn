import { isA } from "../../realm";
import { composedParent, deepQueryAll } from "../../shadow-control";

import { isDisplayed, isPlaceholderOption, normalize, optionText } from "./options-dom";

/**
 * Finding a popup's options when the page gave them no ARIA roles. A dropdown drawn from
 * plain elements opens a list of plain elements: nothing in their markup says "option". What
 * does say it is what happened when the control was opened: a group of similar short rows
 * appeared, near the control. The page is looked at before the control is opened and again
 * after, and the rows that are new are the options. The decision model then chooses among
 * their texts, as for any list. Structure and timing only: no tag, class, or wording.
 */

/** Longest text a row of a list may have. */
const ROW_TEXT_MAX_CHARS = 80;
/** Fewest rows that make a list: one new line of text is a message, not a list. */
const LIST_MIN_ROWS = 2;
/** Most rows read from one popup. */
const LIST_MAX_ROWS = 600;

/** Elements a person can see right now, in this document and the open shadow roots under it. */
export function visibleElements(doc: Document): Set<Element> {
  const seen = new Set<Element>();
  for (const el of deepQueryAll(doc, "*")) {
    if (isA(el, HTMLElement) && isDisplayed(el)) seen.add(el);
  }
  return seen;
}

/** A row's own words: its text when it holds no other element with text of its own. */
function rowText(el: HTMLElement): string {
  return optionText(el);
}

/** How far a popup sits from the control it opened from: its top-left against the control's bottom-left. */
function distanceFrom(control: HTMLElement, el: Element): number {
  const c = control.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return Math.abs(r.left - c.left) + Math.abs(r.top - c.bottom);
}

/**
 * The rows of the list that opened since `before`: elements that are new and visible, each
 * with short text and no new element inside it that has text of its own, grouped by the
 * element holding them; the best group is the one nearest the control (ties: the longer).
 */
export function newPopupRows(
  control: HTMLElement,
  before: Set<Element>,
  doc: Document,
): HTMLElement[] {
  const fresh = deepQueryAll(doc, "*").filter(
    (el): el is HTMLElement =>
      isA(el, HTMLElement) &&
      !before.has(el) &&
      isDisplayed(el) &&
      el !== control &&
      !el.contains(control) &&
      !control.contains(el),
  );
  const freshSet = new Set<Element>(fresh);
  const rows = fresh.filter((el) => {
    const text = rowText(el);
    if (!text || text.length > ROW_TEXT_MAX_CHARS || isPlaceholderOption(text)) return false;
    // The row is the innermost new element with the text: not a wrapper around such rows.
    return !Array.from(el.children).some(
      (child) => freshSet.has(child) && rowText(child as HTMLElement) !== "",
    );
  });
  const groups = new Map<Element, HTMLElement[]>();
  for (const row of rows) {
    const holder = composedParent(row);
    if (!holder) continue;
    groups.set(holder, [...(groups.get(holder) ?? []), row]);
  }
  let best: HTMLElement[] = [];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [holder, group] of groups) {
    const distinct = new Set(group.map((row) => normalize(rowText(row))));
    if (group.length < LIST_MIN_ROWS || distinct.size < LIST_MIN_ROWS) continue;
    const distance = distanceFrom(control, holder);
    const better =
      distance < bestDistance || (distance === bestDistance && group.length > best.length);
    if (better) {
      best = group;
      bestDistance = distance;
    }
  }
  return best.slice(0, LIST_MAX_ROWS);
}
