import { POPUP_SELECTOR } from "./popup-roles";

/**
 * Virtualized menus keep an invisible ARIA mirror (role=option, zero size) for screen
 * readers while the rows people see carry no role. Clicking the mirror does nothing,
 * so when every collected option is invisible, use the visible text in the same popup.
 */

/** Boxes this small are screen-reader-only, not something a person can click. */
const MIRROR_MAX_PX = 1;

function hasVisibleBox(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > MIRROR_MAX_PX && rect.height > MIRROR_MAX_PX;
}

function ownText(el: Element): string {
  return Array.from(el.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent || "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nearest ancestor a person can see: the popup that holds both mirror and rows. */
function visiblePopup(mirror: Element): Element | null {
  let node = mirror.parentElement;
  while (node && node !== node.ownerDocument.body) {
    if (hasVisibleBox(node)) return node;
    node = node.parentElement;
  }
  return null;
}

/** The options to read and click: the collected ones, or their visible rows when all are mirrors. */
export function visibleOptions(options: HTMLElement[]): HTMLElement[] {
  if (!options.length || options.some(hasVisibleBox)) return options;
  const mirrorList = options[0].closest(POPUP_SELECTOR) ?? options[0];
  const popup = visiblePopup(mirrorList);
  if (!popup) return [];
  return Array.from(popup.querySelectorAll<HTMLElement>("*")).filter(
    (el) => !mirrorList.contains(el) && ownText(el) !== "" && hasVisibleBox(el),
  );
}
