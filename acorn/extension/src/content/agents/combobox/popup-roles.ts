/**
 * The popups an ARIA combobox may control, and the item a person picks in each:
 * listbox → option, grid → gridcell, tree → treeitem.
 */
export const POPUP_SELECTOR = '[role="listbox"], [role="grid"], [role="tree"]';
export const POPUP_ITEM_SELECTOR = '[role="option"], [role="gridcell"], [role="treeitem"]';

/**
 * Controls that open a popup of options: ARIA comboboxes, selects, listbox
 * buttons, and search boxes whose results are picked (standard attributes only).
 */
export const POPUP_OWNER_SELECTOR =
  '[role="combobox"], select, [aria-haspopup="listbox"], [role="searchbox"], [enterkeyhint="search"], input[type="search"]';
