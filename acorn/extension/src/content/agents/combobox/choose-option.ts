import { traceFromPage } from "../../../debug-trace";
import { containsWords } from "../choice-group";
import { isSearchBox } from "../field-focus";
import { readControlValue } from "../read-control-value";
import { waitMs } from "../wait";

import { estimateOptionAnswer } from "./estimate-client";
import { decideAmongOptions, findExactOption, type OptionDecision } from "./match";
import { normalize, optionSignature, optionText, popupState } from "./options-dom";
import { openAndCollectOptions, waitForFilteredOptions } from "./options-wait";
import { laterWordQueries } from "./query-variants";
import {
  dismissOpenOverlays,
  focusAndOpenCombobox,
  resolveTypeableInput,
  settlePopupClosed,
  typeQueryIntoOpenCombobox,
  typeaheadFilterWaitMs,
} from "./typing";

/** How many option labels a trace event carries. */
const TRACE_SAMPLE = 10;
/** Time for a widget to put back or clear typed text after its suggestions close. */
const TYPED_KEEP_SETTLE_MS = 250;
/** Some menus render their options a beat after opening. */
const EMPTY_MENU_RETRY_MS = 450;
/**
 * The SelectorGateway (Jev) is billed per input token, and a list of a few hundred short
 * options is a couple of thousand tokens: far cheaper than narrowing it by typing, which
 * costs a wait of seconds per step. A list this short is read whole; a longer one is
 * narrowed by typing first.
 */
export const JEV_LIST_MAX = 300;
/**
 * A list longer than this that answered "not listed" may still be a partial window (a search
 * box shows more once typed into): it is searched, instead of taken as the whole list.
 */
export const PARTIAL_LIST_MIN = 30;

export type ChooseResult = {
  match: HTMLElement | null;
  /** The candidates the decision saw (for the error message). */
  options: HTMLElement[];
  /** No option is the answer, and the field kept the answer typed as written. */
  kept?: string;
};

export type ChooseOptions = {
  /** Type into the search box to narrow a long list (default true). */
  allowTypeahead: boolean;
  /**
   * `value` is an instruction ("answer from the profile"), not text to type: a long
   * list asks the writer for an estimated answer and types that instead.
   */
  estimateQuery?: boolean;
  /** The writer's estimate, already requested (the leftover pass asks for all at once). */
  estimate?: Promise<string | null>;
  /**
   * The list was read already and is too long, or empty until typed into: skip
   * opening it again and type the query right away.
   */
  searchFirst?: boolean;
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
 *    When the answer is not listed as written it is searched from later words of
 *    it; a field that takes typed text keeps it as written; otherwise the list is
 *    decided once more, and a specific fact (a place, a school) that no option is
 *    stays unanswered rather than become a different one.
 */
export async function chooseOption(
  control: HTMLElement,
  doc: Document,
  value: string,
  fieldLabel: string | null,
  { allowTypeahead, estimateQuery = false, estimate, searchFirst = false }: ChooseOptions,
): Promise<ChooseResult> {
  const estimated = () => estimate ?? estimateOptionAnswer(fieldLabel);
  const typeable = resolveTypeableInput(control);
  // A search box shows its real answers only once searched: its open list is a
  // menu of categories, not the answers. Search with the value before reading.
  const searchBox = Boolean(typeable && isSearchBox(typeable));
  if ((searchFirst || searchBox) && allowTypeahead && typeable) {
    const query = estimateQuery ? await estimated() : value;
    traceFromPage("combo:search-first", () => ({ value, query }));
    if (query && query.trim().length >= 2) {
      dismissOpenOverlays(doc, control);
      return narrowAndDecide(control, doc, query, fieldLabel, []);
    }
  }
  const openStarted = Date.now();
  dismissOpenOverlays(doc, control);
  await waitMs(40);
  let initial = await openAndCollectOptions(control, doc);
  if (!initial.length) {
    dismissOpenOverlays(doc, control);
    await waitMs(EMPTY_MENU_RETRY_MS);
    initial = await openAndCollectOptions(control, doc);
  }
  traceFromPage("combo:open", () => ({
    value,
    count: initial.length,
    ms: Date.now() - openStarted,
    ...popupState(control, doc),
  }));

  const exact = estimateQuery ? null : findExactOption(initial, value);
  if (exact) {
    traceFromPage("combo:decide", () => decision(value, null, initial, exact, "exact"));
    return { match: exact, options: initial };
  }

  const canSearch = allowTypeahead && Boolean(resolveTypeableInput(control));
  if (initial.length <= JEV_LIST_MAX || !canSearch) {
    const typeable = !estimateQuery && value.trim().length >= 2;
    // A list that cannot be searched is the whole list: a specific fact missing from
    // it stays unanswered rather than become another (a different city).
    const first = canSearch
      ? await decide(value, fieldLabel, null, initial, typeable)
      : await decide(value, fieldLabel, null, initial, true, true);
    if (first.match || !canSearch) {
      return { match: canSearch ? (first.match ?? first.fallback) : first.match, options: initial };
    }
  }

  const query = estimateQuery ? await estimated() : value;
  traceFromPage("combo:estimate", () => ({ value, query, count: initial.length, estimateQuery }));
  if (!query || query.trim().length < 2) {
    const strict = await decide(value, fieldLabel, null, initial, true, true);
    return { match: strict.match, options: initial };
  }
  return narrowAndDecide(control, doc, query, fieldLabel, initial);
}

/** A typed search and what it showed: the list the last useful word left, and its decision. */
type Searched = {
  match: HTMLElement | null;
  shown: HTMLElement[];
  shownQuery: string | null;
  /** Typing showed suggestions at some point: the field searches as it is typed in. */
  suggested: boolean;
};

/**
 * Narrow the list toward `value`, then decide it. The answer is searched for as
 * written, then from later words of it (a site may list the same school or street
 * under other leading words). Then the list is decided once more, where a specific
 * fact is never swapped for a different one; when no option is the answer, a field
 * that takes typed text keeps it as written.
 */
async function narrowAndDecide(
  control: HTMLElement,
  doc: Document,
  value: string,
  fieldLabel: string | null,
  initial: HTMLElement[],
): Promise<ChooseResult> {
  const whole = await searchWords(control, doc, value, value, fieldLabel, initial);
  if (whole.match) return { match: whole.match, options: whole.shown };
  let suggested = whole.suggested;
  for (const variant of laterWordQueries(value)) {
    const found = await searchWords(control, doc, value, variant, fieldLabel, []);
    traceFromPage("combo:variant", () => ({
      value,
      variant,
      count: found.shown.length,
      match: found.match ? optionText(found.match) : null,
    }));
    if (found.match) return { match: found.match, options: found.shown };
    suggested ||= found.suggested;
  }
  // The listed options first: a list of codes ("CA") answers a typed name
  // ("California"), and a strict list may show typed text it never selects.
  const exact = findExactOption(whole.shown, value);
  if (exact) return { match: exact, options: whole.shown };
  const final = await decide(value, fieldLabel, whole.shownQuery, whole.shown, true, true);
  if (final.match) return { match: final.match, options: whole.shown };
  // Only a field that offered suggestions as it was typed in is a typed field with
  // hints (an address line); a list that showed nothing is a fixed set of choices,
  // and text left in its box answers nothing.
  const kept = suggested ? await keepTypedAnswer(control, doc, value) : null;
  if (kept) traceFromPage("combo:kept-typed", () => ({ value, kept }));
  return { match: null, options: whole.shown, kept: kept ?? undefined };
}

/**
 * Type `query` word by word until the list is short enough to decide, and decide
 * it against `value`. Long lists that typing leaves long are narrowed to the
 * options that hold the whole query before deciding.
 */
async function searchWords(
  control: HTMLElement,
  doc: Document,
  value: string,
  query: string,
  fieldLabel: string | null,
  initial: HTMLElement[],
): Promise<Searched> {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const filterWait = typeaheadFilterWaitMs(doc);
  let shown = initial;
  let shownQuery: string | null = null;
  let emptied = false;
  let suggested = false;

  for (let i = 0; i < words.length; i += 1) {
    const typed = words.slice(0, i + 1).join(" ");
    const lastWord = i === words.length - 1;
    await focusAndOpenCombobox(control);
    await typeQueryIntoOpenCombobox(control, typed);
    const filtered = await waitForFilteredOptions(control, doc, optionSignature(shown), filterWait);
    traceFromPage("combo:narrow", () => ({
      query,
      typed,
      count: filtered.length,
      sample: filtered.slice(0, TRACE_SAMPLE).map(optionText),
      ...popupState(control, doc),
    }));
    if (!filtered.length) {
      emptied = true;
      break;
    }
    suggested = true;
    // A word that left the list as it was (a search a word behind, a word every
    // option shares) says nothing yet: type the next one, which may still narrow it.
    if (optionSignature(filtered) === optionSignature(shown) && !lastWord) continue;
    shown = filtered;
    shownQuery = typed;
    const exact = findExactOption(filtered, value);
    if (exact) {
      traceFromPage("combo:decide", () => decision(value, typed, filtered, exact, "exact"));
      return { match: exact, shown, shownQuery, suggested };
    }
    // The whole query is typed and the list is still long (the widget filters late,
    // or not at all): the options that hold the query are the candidates.
    const candidates =
      filtered.length > JEV_LIST_MAX && lastWord ? holdingQuery(filtered, query) : filtered;
    if (!candidates.length || candidates.length > JEV_LIST_MAX) continue;
    const decided = await decide(value, fieldLabel, typed, candidates, true);
    if (decided.match) return { match: decided.match, shown, shownQuery, suggested };
  }

  // The last word emptied the list: put back the query that still showed candidates.
  if (emptied && shownQuery) {
    await focusAndOpenCombobox(control);
    await typeQueryIntoOpenCombobox(control, shownQuery);
    const restored = await waitForFilteredOptions(control, doc, "", filterWait);
    if (restored.length) shown = restored;
  }
  return { match: null, shown, shownQuery, suggested };
}

/** The options whose text holds every word of the query, in order. */
function holdingQuery(options: HTMLElement[], query: string): HTMLElement[] {
  return options.filter((option) => containsWords(optionText(option), query));
}

/**
 * A field that takes typed text (an address line with suggestions) keeps the answer
 * as written when no suggestion is it. Type it whole, close the suggestions, and
 * read what the field holds: the answer when it kept it, null when it cleared it.
 */
async function keepTypedAnswer(
  control: HTMLElement,
  doc: Document,
  value: string,
): Promise<string | null> {
  const input = resolveTypeableInput(control);
  if (!input || isSearchBox(input)) return null;
  await focusAndOpenCombobox(control);
  await typeQueryIntoOpenCombobox(control, value);
  await settlePopupClosed(control, doc);
  await waitMs(TYPED_KEEP_SETTLE_MS);
  const held = (input.value || readControlValue(control)).replace(/\s+/g, " ").trim();
  return held && normalize(held) === normalize(value) ? held : null;
}

async function decide(
  value: string,
  fieldLabel: string | null,
  typedQuery: string | null,
  options: HTMLElement[],
  allowNotListed: boolean,
  listComplete = false,
): Promise<OptionDecision> {
  const started = Date.now();
  const result = await decideAmongOptions(
    options,
    value,
    fieldLabel,
    typedQuery,
    allowNotListed,
    listComplete,
  );
  traceFromPage("combo:decide", () => ({
    ...decision(value, typedQuery, options, result.match, "jev"),
    ms: Date.now() - started,
    allowNotListed,
    listComplete,
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
