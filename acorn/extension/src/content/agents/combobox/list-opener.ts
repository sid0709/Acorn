import { isA } from "../../realm";
import { composedContains, composedParent, deepQueryAll } from "../../shadow-control";

import { LIST_OPENER_ATTR, POPUP_OWNER_SELECTOR } from "./popup-roles";

/**
 * Dropdowns drawn as a plain button that opens a popup list: no select, no
 * combobox role, no aria-haspopup on the button. What marks one is its shape: a
 * list of options that is shut (not on screen) with a button that is on screen
 * beside it, inside a box that holds no other list. The button is stamped so every
 * dropdown path (the leftover pass, a plan step, the issue scan) treats it as the
 * dropdown it is. Structure only: no tag name, class, or wording is matched.
 */

/** What a person presses to open a popup. */
const OPENER_CANDIDATE_SELECTOR = 'button, [role="button"]';
/** Everything else a person can press or type into inside a box. */
const BOX_CONTROL_SELECTOR =
  'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
/** A button says it opens a popup in standard ARIA: it is expandable, has a popup, or controls one. */
const POPUP_DECLARATIONS = ["aria-expanded", "aria-haspopup", "aria-controls"];
/**
 * Levels above a shut list that still count as its own widget box. A popup pane drawn
 * by a custom element sits several shadow trees deep (list, slot, pane container, pane
 * host) before the box that also holds the button.
 */
const WIDGET_MAX_DEPTH = 8;
const LISTBOX_SELECTOR = '[role="listbox"]';

type Widget = { list: HTMLElement; box: Element };

const widgets = new WeakMap<Element, Widget>();

function isDisplayed(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) return false;
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  if (!style) return true;
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

/** Whether el is a button that opens a popup list, as found by markListOpeners. */
export function isListOpener(el: Element): boolean {
  return el.hasAttribute(LIST_OPENER_ATTR);
}

/** The popup list an opener opens. */
export function listOfOpener(opener: Element): HTMLElement | null {
  return widgets.get(opener)?.list ?? null;
}

/** The box around an opener and its popup, where options that are not inside the list sit. */
export function boxOfOpener(opener: Element): Element | null {
  return widgets.get(opener)?.box ?? null;
}

/**
 * A list some control on screen already names (aria-controls / aria-owns / list): that
 * control is its dropdown. A control that names it and is hidden (a filter input inside
 * the shut popup) is no dropdown anyone can use, so the list still needs an opener.
 */
function namedByShownControl(list: HTMLElement): boolean {
  const id = list.id;
  if (!id) return false;
  const quoted = CSS.escape(id);
  return deepQueryAll(
    list.ownerDocument,
    `[aria-controls~="${quoted}"], [aria-owns~="${quoted}"], [list="${quoted}"]`,
  ).some((node) => isA(node, HTMLElement) && isDisplayed(node) && !list.contains(node));
}

function insideAnyList(el: Element, lists: Element[]): boolean {
  return lists.some((list) => list.contains(el) || list === el);
}

/** The on-screen button that comes before `list` in its own box, or null. */
function openerOf(
  list: HTMLElement,
  allLists: HTMLElement[],
): { opener: Element; box: Element } | null {
  let box = composedParent(list);
  for (let depth = 0; box && depth < WIDGET_MAX_DEPTH; depth += 1) {
    if (box === box.ownerDocument.body || box.tagName === "FORM") return null;
    // A box holding another list is no longer this list's own.
    if (allLists.some((other) => other !== list && composedContains(box!, other))) return null;
    const sameTree = list.getRootNode();
    const candidates = deepQueryAll(box, OPENER_CANDIDATE_SELECTOR).filter((node) => {
      if (!isA(node, HTMLElement) || !isDisplayed(node)) return false;
      if (!POPUP_DECLARATIONS.some((name) => node.hasAttribute(name))) return false;
      if (node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true")
        return false;
      if (insideAnyList(node, allLists)) return false;
      // Before the list, where the two share a tree: the controls after it are the popup's own.
      if (node.getRootNode() === sameTree) {
        return Boolean(list.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING);
      }
      return true;
    });
    if (candidates.length) {
      const opener = candidates[0];
      // A widget is one control with its popup: a box that holds anything else a person can
      // press (a header's menus and links around a hidden list) is a region of the page.
      const others = deepQueryAll(box, BOX_CONTROL_SELECTOR).filter(
        (node) =>
          isA(node, HTMLElement) &&
          node !== opener &&
          isDisplayed(node) &&
          !opener.contains(node) &&
          !node.contains(opener) &&
          !insideAnyList(node, allLists),
      );
      return others.length ? null : { opener, box };
    }
    box = composedParent(box);
  }
  return null;
}

/**
 * Stamp the opener of every shut popup list that no control owns. Cheap enough to
 * run before each scan: a page with no such list costs one query.
 */
export function markListOpeners(): void {
  const lists = deepQueryAll(document, LISTBOX_SELECTOR).filter((node): node is HTMLElement =>
    isA(node, HTMLElement),
  );
  for (const list of lists) {
    // A list on screen is a control of its own, never a popup; one a control names has its dropdown.
    if (isDisplayed(list) || namedByShownControl(list)) continue;
    const found = openerOf(list, lists);
    if (!found) continue;
    // A box that already has an on-screen dropdown of the usual kind needs no stamp.
    const owners = deepQueryAll(found.box, POPUP_OWNER_SELECTOR).filter(
      (node) => node !== found.opener && isA(node, HTMLElement) && isDisplayed(node),
    );
    if (owners.length) continue;
    found.opener.setAttribute(LIST_OPENER_ATTR, "");
    widgets.set(found.opener, { list, box: found.box });
  }
}
