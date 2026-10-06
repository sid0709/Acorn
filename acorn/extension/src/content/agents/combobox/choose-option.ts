import { traceFromPage } from "../../../debug-trace";
import { waitMs } from "../wait";
import { estimateOptionAnswer } from "./estimate-client";
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
/**
 * The SelectorGateway (Jev) is billed per input token, so it reads a list only
 * once it is this short. Longer lists are narrowed by typing first.
 */
export const JEV_LIST_MAX = 30;

export type ChooseResult = {
  match: HTMLElement | null;
  /** The candidates the decision saw (for the error message). */
  options: HTMLElement[];
};

export type ChooseOptions = {
  /** Type into the search box to narrow a long list (default true). */
  allowTypeahead: boolean;
  /**
   * `value` is an instruction ("answer from the profile"), not text to type: a long
   * list asks the writer for an estimated answer and types that instead.
   */
  estimateQuery?: boolean;
};

/**
 * Pick the option for `value`:
 * 1) an option whose text is exactly the value wins;
 * 2) a list of JEV_LIST_MAX or fewer (or one with no search box) goes to Jev once,
 *    whole. Jev picks the most probable option; with a search box it may answer
 *    "not listed" because the open list can be a partial window;
 * 3) a longer list is narrowed by typing the estimated answer word by word
 *    ("United" → the United… countries) until JEV_LIST_MAX or fewer remain, and
 *    Jev decides that list. The estimate is the planned value, or — for a field
 *    the plan did not answer — a short answer from the writer (normal model).
 *    When typing runs out, the most probable option of the last list wins.
 */
export async function chooseOption(
  control: HTMLElement,
  doc: Document,
  value: string,
  fieldLabel: string | null,
  { allowTypeahead, estimateQuery = false }: ChooseOptions,
): Promise<ChooseResult> {
  dismissOpenOverlays(doc, control);
  await waitMs(40);
  let initial = await openAndCollectOptions(control, doc);
  if (!initial.length) {
    dismissOpenOverlays(doc, control);
    await waitMs(EMPTY_MENU_RETRY_MS);
    initial = await openAndCollectOptions(control, doc);
  }

  const exact = estimateQuery ? null : findExactOption(initial, value);
  if (exact) {
    traceFromPage("combo:decide", () => decision(value, null, initial, exact, "exact"));
    return { match: exact, options: initial };
  }

  const canSearch = allowTypeahead && Boolean(resolveTypeableInput(control));
  if (initial.length <= JEV_LIST_MAX || !canSearch) {
    const typeable = !estimateQuery && value.trim().length >= 2;
    const first = await decide(value, fieldLabel, null, initial, canSearch && typeable);
    if (first.match || !canSearch)
      return { match: first.match ?? first.fallback, options: initial };
  }

  const query = estimateQuery ? await estimateOptionAnswer(fieldLabel) : value;
  traceFromPage("combo:estimate", () => ({ value, query, count: initial.length, estimateQuery }));
  if (!query || query.trim().length < 2) {
    const forced = await decide(value, fieldLabel, null, initial, false);
    return { match: forced.match ?? forced.fallback, options: initial };
  }
  return narrowAndDecide(control, doc, query, fieldLabel, initial);
}

async function narrowAndDecide(
  control: HTMLElement,
  doc: Document,
  query: string,
  fieldLabel: string | null,
  initial: HTMLElement[],
): Promise<ChooseResult> {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const filterWait = typeaheadFilterWaitMs(doc);
  let shown = initial;
  let shownQuery: string | null = null;
  let shownDecision: OptionDecision | null = null;
  let emptied = false;

  for (let i = 0; i < words.length; i += 1) {
    const typed = words.slice(0, i + 1).join(" ");
    await focusAndOpenCombobox(control);
    await typeQueryIntoOpenCombobox(control, typed);
    const filtered = await waitForFilteredOptions(control, doc, optionSignature(shown), filterWait);
    traceFromPage("combo:narrow", () => ({
      query,
      typed,
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
    shownQuery = typed;
    shownDecision = null;
    const exact = findExactOption(filtered, query);
    if (exact) {
      traceFromPage("combo:decide", () => decision(query, typed, filtered, exact, "exact"));
      return { match: exact, options: filtered };
    }
    if (filtered.length > JEV_LIST_MAX) continue;
    const moreWords = i < words.length - 1;
    shownDecision = await decide(query, fieldLabel, typed, filtered, moreWords);
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
  const exact = findExactOption(shown, query);
  if (exact) return { match: exact, options: shown };
  // Nothing left to search: select the most probable listed option rather than leave it blank.
  const final = shownDecision ?? (await decide(query, fieldLabel, shownQuery, shown, false));
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
