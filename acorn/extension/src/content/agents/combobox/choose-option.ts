import { traceFromPage } from "../../../debug-trace";
import { waitMs } from "../wait";
import { decideAmongOptions, findExactOption } from "./match";
import { optionSignature, optionText } from "./options-dom";
import { openAndCollectOptions, waitForFilteredOptions } from "./options-wait";
import {
  dismissOpenOverlays,
  focusAndOpenCombobox,
  resolveTypeableInput,
  typeQueryIntoOpenCombobox,
  typeaheadFilterWaitMs,
} from "./typing";

/** Few enough candidates for one AI decision; typing stops narrowing at this size. */
export const AI_CANDIDATE_MAX = 10;
/** Some menus render their options a beat after opening. */
const EMPTY_MENU_RETRY_MS = 450;

export type ChooseResult = {
  match: HTMLElement | null;
  /** The candidates the decision saw (for the error message). */
  options: HTMLElement[];
};

/**
 * Pick the option for `value` the way a person would:
 * 1) an option whose text is exactly the value wins;
 * 2) a short list (or one with no search box) goes to the AI once, whole;
 * 3) otherwise type the value word by word until the list is short, then ask the
 *    AI once. "Not here" with words left types the next word. A word that empties
 *    the list is backed out and the last non-empty list decides.
 */
export async function chooseOption(
  control: HTMLElement,
  doc: Document,
  value: string,
  fieldLabel: string | null,
  allowTypeahead: boolean,
): Promise<ChooseResult> {
  dismissOpenOverlays(doc, control);
  await waitMs(40);
  let initial = await openAndCollectOptions(control, doc);
  if (!initial.length) {
    dismissOpenOverlays(doc, control);
    await waitMs(EMPTY_MENU_RETRY_MS);
    initial = await openAndCollectOptions(control, doc);
  }

  const exact = findExactOption(initial, value);
  if (exact) {
    traceFromPage("combo:decide", () => decision(value, null, initial, exact, "exact"));
    return { match: exact, options: initial };
  }

  const canType =
    allowTypeahead && Boolean(resolveTypeableInput(control)) && value.trim().length >= 2;
  const short = initial.length > 0 && initial.length <= AI_CANDIDATE_MAX;
  if (!canType || short) {
    const match = await decide(value, fieldLabel, null, initial);
    // A short list may be a virtualized or paged window: "not here" means search on.
    if (match || !canType) return { match, options: initial };
  }

  return narrowAndDecide(control, doc, value, fieldLabel, initial, short);
}

async function narrowAndDecide(
  control: HTMLElement,
  doc: Document,
  value: string,
  fieldLabel: string | null,
  initial: HTMLElement[],
  initialDecided: boolean,
): Promise<ChooseResult> {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const filterWait = typeaheadFilterWaitMs(doc);
  let shown = initial;
  let shownQuery: string | null = null;
  let decidedSig: string | null = initialDecided ? optionSignature(initial) : null;
  let emptied = false;

  for (let i = 0; i < words.length; i += 1) {
    const query = words.slice(0, i + 1).join(" ");
    await focusAndOpenCombobox(control);
    await typeQueryIntoOpenCombobox(control, query);
    const filtered = await waitForFilteredOptions(control, doc, optionSignature(shown), filterWait);
    traceFromPage("combo:narrow", () => ({
      value,
      query,
      count: filtered.length,
      sample: filtered.slice(0, AI_CANDIDATE_MAX).map(optionText),
    }));
    if (!filtered.length) {
      emptied = true;
      break;
    }
    const unchanged = optionSignature(filtered) === optionSignature(shown);
    shown = filtered;
    shownQuery = query;
    if (filtered.length <= AI_CANDIDATE_MAX) {
      const exact = findExactOption(filtered, value);
      const match = exact ?? (await decide(value, fieldLabel, query, filtered));
      if (exact) {
        traceFromPage("combo:decide", () => decision(value, query, filtered, exact, "exact"));
      }
      decidedSig = optionSignature(filtered);
      if (match) return { match, options: filtered };
    }
    // Typing that no longer changes the list will not narrow it further.
    if (unchanged) break;
  }

  if (decidedSig === optionSignature(shown)) return { match: null, options: shown };

  // The last word emptied the list: put back the query that still showed candidates.
  if (emptied) {
    await focusAndOpenCombobox(control);
    if (shownQuery) await typeQueryIntoOpenCombobox(control, shownQuery);
    const restored = await waitForFilteredOptions(control, doc, "", filterWait);
    if (restored.length) shown = restored;
  }
  const match =
    findExactOption(shown, value) ?? (await decide(value, fieldLabel, shownQuery, shown));
  return { match, options: shown };
}

async function decide(
  value: string,
  fieldLabel: string | null,
  typedQuery: string | null,
  options: HTMLElement[],
): Promise<HTMLElement | null> {
  const match = await decideAmongOptions(options, value, fieldLabel, typedQuery);
  traceFromPage("combo:decide", () => decision(value, typedQuery, options, match, "ai"));
  return match;
}

function decision(
  value: string,
  typed: string | null,
  options: HTMLElement[],
  match: HTMLElement | null,
  by: "exact" | "ai",
) {
  return {
    value,
    typed,
    by,
    count: options.length,
    sample: options.slice(0, AI_CANDIDATE_MAX).map(optionText),
    match: match ? optionText(match) : null,
  };
}
