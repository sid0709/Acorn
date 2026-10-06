import { traceFromPage } from "../../../debug-trace";
import { waitMs } from "../wait";
import { decideAmongOptions, findExactOption, type OptionDecision } from "./match";
import { optionSignature, optionText } from "./options-dom";
import { openAndCollectOptions, waitForFilteredOptions } from "./options-wait";
import {
  dismissOpenOverlays,
  focusAndOpenCombobox,
  resolveTypeableInput,
  typeQueryIntoOpenCombobox,
  typeaheadFilterWaitMs,
} from "./typing";

/** How many option labels a trace event carries. */
const TRACE_SAMPLE = 10;
/** Some menus render their options a beat after opening. */
const EMPTY_MENU_RETRY_MS = 450;

export type ChooseResult = {
  match: HTMLElement | null;
  /** The candidates the decision saw (for the error message). */
  options: HTMLElement[];
};

/**
 * Pick the option for `value`:
 * 1) an option whose text is exactly the value wins;
 * 2) otherwise the SelectorGateway (Jev) reads the whole open list at once — no
 *    typing. Without a search box the list is complete, so it always picks one:
 *    the option that means the value, or the closest one an applicant would
 *    choose (a broader category, or "Other");
 * 3) with a search box the open list may be a partial window, so Jev may answer
 *    "not listed". Only then type the value word by word to reveal more, deciding
 *    on each new list. When typing runs out, the best option of the last list wins.
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
  const first = await decide(value, fieldLabel, null, initial, canType);
  if (first.match || !canType) return { match: first.match ?? first.fallback, options: initial };

  return narrowAndDecide(control, doc, value, fieldLabel, initial, first);
}

async function narrowAndDecide(
  control: HTMLElement,
  doc: Document,
  value: string,
  fieldLabel: string | null,
  initial: HTMLElement[],
  initialDecision: OptionDecision,
): Promise<ChooseResult> {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const filterWait = typeaheadFilterWaitMs(doc);
  let shown = initial;
  let shownQuery: string | null = null;
  let shownDecision: OptionDecision | null = initialDecision;
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
      sample: filtered.slice(0, TRACE_SAMPLE).map(optionText),
    }));
    if (!filtered.length) {
      emptied = true;
      break;
    }
    // Typing that no longer changes the list will not narrow it further.
    if (optionSignature(filtered) === optionSignature(shown)) break;
    shown = filtered;
    shownQuery = query;
    const exact = findExactOption(filtered, value);
    if (exact) {
      traceFromPage("combo:decide", () => decision(value, query, filtered, exact, "exact"));
      return { match: exact, options: filtered };
    }
    shownDecision = await decide(value, fieldLabel, query, filtered, true);
    if (shownDecision.match) return { match: shownDecision.match, options: filtered };
  }

  // The last word emptied the list: put back the query that still showed candidates.
  if (emptied) {
    await focusAndOpenCombobox(control);
    if (shownQuery) await typeQueryIntoOpenCombobox(control, shownQuery);
    const restored = await waitForFilteredOptions(control, doc, "", filterWait);
    if (restored.length) {
      if (optionSignature(restored) !== optionSignature(shown)) shownDecision = null;
      shown = restored;
    }
  }
  const exact = findExactOption(shown, value);
  if (exact) return { match: exact, options: shown };
  // Nothing left to search: select the best listed option rather than leave it blank.
  const final = shownDecision ?? (await decide(value, fieldLabel, shownQuery, shown, false));
  return { match: final.match ?? final.fallback, options: shown };
}

async function decide(
  value: string,
  fieldLabel: string | null,
  typedQuery: string | null,
  options: HTMLElement[],
  allowNotListed: boolean,
): Promise<OptionDecision> {
  const result = await decideAmongOptions(options, value, fieldLabel, typedQuery, allowNotListed);
  traceFromPage("combo:decide", () => ({
    ...decision(value, typedQuery, options, result.match, "jev"),
    allowNotListed,
    fallback: result.fallback ? optionText(result.fallback) : null,
  }));
  return result;
}

function decision(
  value: string,
  typed: string | null,
  options: HTMLElement[],
  match: HTMLElement | null,
  by: "exact" | "jev",
) {
  return {
    value,
    typed,
    by,
    count: options.length,
    sample: options.slice(0, TRACE_SAMPLE).map(optionText),
    match: match ? optionText(match) : null,
  };
}
