import { traceFromPage } from "../../debug-trace";
import { isA } from "../realm";

import { chooseOption } from "./combobox/choose-option";
import { decideAmongOptions, findExactOption } from "./combobox/match";
import {
  optionSignature,
  optionText,
  ownedPopupOpen,
  pickScopedOptions,
} from "./combobox/options-dom";
import { findLiveOption } from "./combobox/options-wait";
import { dismissOpenOverlays, settlePopupClosed } from "./combobox/typing";
import { comboboxWidgetRoot } from "./combobox/widget-value";
import { resolveDropdownInteractionTarget } from "./enhanced-select";
import { fillNativeSelect } from "./native-select";
import { pointerActivate } from "./pointer-activate";
import { readControlValue } from "./read-control-value";
import { waitMs } from "./wait";

/** Menus whose options open a deeper level are followed at most this deep. */
const MAX_MENU_DEPTH = 3;
/** A deeper level of a menu draws a moment after its parent option is clicked. */
const SUBMENU_WAIT_MS = 700;
/** How often a click's outcome is looked at while waiting for it. */
const SUBMENU_POLL_MS = 40;
/** Looks in a row that must find the popup closed before the pick counts as final. */
const SUBMENU_CLOSED_POLLS = 3;

/**
 * The options a menu shows now that it did not show before the click: a deeper
 * level opened by the clicked option. Options inside the field itself (the items
 * already picked) are not a menu.
 */
function deeperOptions(control: HTMLElement, doc: Document, before: string): HTMLElement[] {
  // Only this control's own popup: never another field's list or picked items.
  const field = comboboxWidgetRoot(control);
  const options = pickScopedOptions(control, doc).filter((option) => !field.contains(option));
  return options.length && optionSignature(options) !== before ? options : [];
}

/**
 * A clicked option that opens a deeper level of the menu instead of being chosen
 * (a category holding the answer): decide again among the deeper options, and
 * click, until an option is chosen. Returns the deepest option clicked, if any.
 */
async function followSubmenus(
  control: HTMLElement,
  doc: Document,
  value: string,
  fieldLabel: string | null,
  shown: HTMLElement[],
): Promise<HTMLElement | null> {
  let before = optionSignature(shown);
  let deepest: HTMLElement | null = null;
  for (let depth = 1; depth <= MAX_MENU_DEPTH; depth += 1) {
    // A click either closes the popup (the answer is chosen) or opens a deeper level:
    // look at which it did as soon as it shows, instead of waiting out the longest case.
    const waited = Date.now();
    let closedPolls = 0;
    while (Date.now() - waited < SUBMENU_WAIT_MS) {
      await waitMs(SUBMENU_POLL_MS);
      if (deeperOptions(control, doc, before).length) break;
      // Closed for a few looks in a row: a menu mid-redraw is not closed.
      closedPolls = ownedPopupOpen(control) ? 0 : closedPolls + 1;
      if (closedPolls >= SUBMENU_CLOSED_POLLS) break;
    }
    const deeper = deeperOptions(control, doc, before);
    if (!deeper.length) return deepest;
    const exact = findExactOption(deeper, value);
    const decided = exact ? null : await decideAmongOptions(deeper, value, fieldLabel, null, false);
    const choice = exact ?? decided?.match ?? decided?.fallback ?? null;
    traceFromPage("combo:submenu", () => ({
      depth,
      value,
      count: deeper.length,
      sample: deeper.slice(0, 10).map(optionText),
      choice: choice ? optionText(choice) : null,
    }));
    if (!choice) return deepest;
    choice.scrollIntoView({ block: "nearest", behavior: "auto" });
    pointerActivate(choice);
    deepest = choice;
    before = optionSignature(deeper);
  }
  return deepest;
}

export interface ComboboxFillOptions {
  /** Type into the search box to narrow a long list (default true). */
  allowTypeahead?: boolean;
  /** `value` is an instruction, not a search: a long list types the writer's estimate instead. */
  estimateQuery?: boolean;
  /** See ChooseOptions: a writer estimate already requested. */
  estimate?: Promise<string | null>;
  /** See ChooseOptions: the list was read already; type the query right away. */
  searchFirst?: boolean;
}

/** Choose the option for `value` (see chooseOption), click it, and leave the popup closed. */
export async function selectComboboxOption(
  el: Element,
  value: string,
  fieldHint?: string | null,
  { allowTypeahead = true, estimateQuery = false, estimate, searchFirst }: ComboboxFillOptions = {},
): Promise<string> {
  const requested = el as HTMLElement;
  if (isA(requested, HTMLSelectElement)) {
    return fillNativeSelect(requested, value);
  }
  const html = resolveDropdownInteractionTarget(requested);
  if (isA(html, HTMLSelectElement)) {
    return fillNativeSelect(html, value);
  }
  const doc = html.ownerDocument || document;
  const fromDom =
    html.getAttribute("aria-label") ||
    requested.getAttribute("aria-label") ||
    (html.id
      ? doc.querySelector(`label[for="${CSS.escape(html.id)}"]`)?.textContent?.trim()
      : null) ||
    (requested.id
      ? doc.querySelector(`label[for="${CSS.escape(requested.id)}"]`)?.textContent?.trim()
      : null) ||
    null;
  const fieldLabel =
    [fieldHint, fromDom]
      .map((part) =>
        String(part || "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)
      .filter(
        (part, i, all) =>
          all.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === i,
      )
      .join(" ") || null;

  const { match, options, kept } = await chooseOption(html, doc, value, fieldLabel, {
    allowTypeahead,
    estimateQuery,
    estimate,
    searchFirst,
  });
  // No suggestion is the answer, and the field holds it as typed.
  if (!match && kept) return kept;
  if (!match) {
    dismissOpenOverlays(doc, html);
    throw new Error(
      `No combobox option matching "${value}" (saw: ${options
        .slice(0, 6)
        .map(optionText)
        .join(" | ")})`,
    );
  }

  const label = optionText(match);
  traceFromPage("combo:click", () => ({ value, label, connected: match.isConnected }));
  const clickStarted = Date.now();
  const live = match.isConnected ? match : await findLiveOption(html, doc, label);
  const clickTarget = live || match;
  clickTarget.scrollIntoView({ block: "nearest", behavior: "auto" });
  pointerActivate(clickTarget);
  const deepest = await followSubmenus(html, doc, value, fieldLabel, options);
  const closed = await settlePopupClosed(html, doc);

  const displayed = readControlValue(html);
  traceFromPage("combo:after-click", () => ({
    ms: Date.now() - clickStarted,
    value,
    label,
    closed,
    displayed,
    inputValue: isA(html, HTMLInputElement) ? html.value : undefined,
  }));
  const selected =
    displayed ||
    (isA(html, HTMLInputElement) && html.value) ||
    html.getAttribute("data-value") ||
    optionText(deepest ?? match);

  return selected;
}
