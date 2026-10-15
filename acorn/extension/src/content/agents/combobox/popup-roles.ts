/**
 * The popups an ARIA combobox may control, and the item a person picks in each:
 * listbox → option, grid → gridcell, tree → treeitem.
 */
export const POPUP_SELECTOR = '[role="listbox"], [role="grid"], [role="tree"]';
export const POPUP_ITEM_SELECTOR = '[role="option"], [role="gridcell"], [role="treeitem"]';

/** The stamp on a button that opens a popup list without saying so in ARIA (see list-opener.ts). */
export const LIST_OPENER_ATTR = "data-acorn-opens-list";

/**
 * The controls a person opens a list of options with, besides a select: ARIA
 * comboboxes and listbox buttons, search boxes whose results are picked, and
 * the buttons stamped as list openers.
 */
export const DROPDOWN_SELECTOR = `[role="combobox"], select, [aria-haspopup="listbox"], [${LIST_OPENER_ATTR}]`;

/**
 * Controls that open a popup of options: the dropdowns above and search boxes
 * whose results are picked (standard attributes only).
 */
export const POPUP_OWNER_SELECTOR = `${DROPDOWN_SELECTOR}, [role="searchbox"], [enterkeyhint="search"], input[type="search"]`;
