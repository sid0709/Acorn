import { traceFromPage } from "../../debug-trace";
import { fieldWrapper, groupQuestion, partGroupName, sectionTitle } from "../form-dom";
import { deepQueryAll } from "../shadow-control";
import { forLabelOf, labelCandidates, normalize, uniqueById } from "../verify/element-labels";

import { JEV_LIST_MAX } from "./combobox/choose-option";
import { estimateOptionAnswer } from "./combobox/estimate-client";
import { isListOpener, markListOpeners } from "./combobox/list-opener";
import { optionText } from "./combobox/options-dom";
import { openAndCollectOptions } from "./combobox/options-wait";
import { DROPDOWN_SELECTOR } from "./combobox/popup-roles";
import { dismissOpenOverlays, resolveTypeableInput } from "./combobox/typing";
import { resolveDropdownInteractionTarget } from "./enhanced-select";
import { fillElement } from "./fill";
import { askAiMatchOption } from "./match-option-client";
import { optionLabel, realOptions } from "./native-select";
import { rememberPlanFilled, wasPlanFilled } from "./plan-fill-registry";
import { readControlValue } from "./read-control-value";

/** Planner-less leftover controls: matcher AI answers from the applicant profile. */
const PROFILE_ANSWER = "Answer from the applicant profile";
/** Dropdowns the plan did not answer (in fast fill: every custom dropdown). */
const MAX_LEFTOVER = 40;
/** Look-again rounds for dropdowns that earlier answers revealed. */
const MAX_LEFTOVER_ROUNDS = 3;
/**
 * Tries per dropdown. A pick that does not show afterwards (the click landed in a
 * list that was not this dropdown's, or the widget dropped it) is tried once more
 * from a freshly opened list before the dropdown counts as unfilled.
 */
const LEFTOVER_FILL_ATTEMPTS = 2;

function isDisplayed(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!style) return true;
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function isCombobox(el: HTMLElement): boolean {
  const role = (el.getAttribute("role") || "").toLowerCase();
  return (
    role === "combobox" ||
    el instanceof HTMLSelectElement ||
    el.getAttribute("aria-haspopup") === "listbox" ||
    isListOpener(el)
  );
}

/**
 * A dropdown's name, with its question: a control inside a fieldset is asked the
 * fieldset's legend (HTML's own label for a group), which a bare name such as
 * "Select One" leaves out. A part of a date asks the date its group names ("Start
 * Date" around "Month"), and both ask within their section ("Education"): a bare
 * "Month" says nothing of whose month.
 */
function fieldLabel(el: HTMLElement): string {
  const own = ownLabel(el);
  const legend = el
    .closest("fieldset")
    ?.querySelector("legend")
    ?.textContent?.replace(/\s+/g, " ")
    .trim();
  const parts: string[] = [];
  for (const part of [sectionTitle(el), legend ?? "", partGroupName(el), own]) {
    const text = part.replace(/\s+/g, " ").trim();
    if (!text || parts.some((kept) => kept.toLowerCase().includes(text.toLowerCase()))) continue;
    // A broader part the next one already says ("Start Date" in "Start Date Month") is dropped.
    const said = parts.findIndex((kept) => text.toLowerCase().includes(kept.toLowerCase()));
    if (said >= 0) parts.splice(said, 1);
    parts.push(text);
  }
  return parts.join(" — ");
}

function ownLabel(el: HTMLElement): string {
  // A button over a shut list sits in its widget's shadow root: its question is the
  // label the page ties to the widget, found beside it, never the placeholder it shows.
  if (isListOpener(el)) {
    const asked = labelCandidates(el).find(
      (text) => normalize(text) !== normalize(el.textContent ?? ""),
    );
    if (asked) return asked;
  }
  const labelled = el.getAttribute("aria-labelledby");
  if (labelled) {
    const parts = labelled
      .split(/\s+/)
      .map((id) => uniqueById(el, id)?.textContent?.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  const aria = el.getAttribute("aria-label")?.replace(/\s+/g, " ").trim();
  if (aria) return aria;
  const forLabel = forLabelOf(el)?.replace(/\s+/g, " ").trim();
  if (forLabel) return forLabel;
  const wrap = el.closest("label")?.textContent?.replace(/\s+/g, " ").trim();
  if (wrap) return wrap.slice(0, 200);
  // No label points at the control itself (a typeahead with no id): the field's
  // question is the title before it inside its own wrapper.
  const nearby = groupQuestion(fieldWrapper(el), el, [el]);
  if (nearby || !isListOpener(el)) return nearby;
  // A button over a shut list sits in its widget's shadow root: the question is beside the widget.
  return (
    labelCandidates(el).find((text) => normalize(text) !== normalize(el.textContent ?? "")) ?? ""
  );
}

/**
 * Values a site put in itself that the profile was found to agree with, by the
 * dropdown that shows them: while one still shows that value it is not judged
 * again, so a page looked at round after round costs no model call for it.
 */
const agreedValues = new WeakMap<Element, string>();

/**
 * Fill the dropdowns no plan step answered. Nothing new is started after
 * `deadline` (ms since epoch): the run has moved on and needs the page. `within`
 * keeps the pass to some dropdowns (what a click opened); null answers them all.
 * `checkPrefilled` also answers again the values the site put in itself that the
 * profile contradicts; a refill, which answers only what the page asks for, leaves them.
 */
export async function fillLeftoverComboboxes(
  deadline = Number.POSITIVE_INFINITY,
  within: ((el: Element) => boolean) | null = null,
  checkPrefilled = true,
): Promise<{
  found: number;
  filled: number;
  stopped?: boolean;
}> {
  const late = () => Date.now() > deadline;
  // A dropdown drawn as a button over a shut list is found by its shape, not its role.
  markListOpeners();
  // Answers reveal follow-up dropdowns (a race list after "Hispanic or Latino?"),
  // so look again after each round for empty ones not tried yet.
  const tried = new Set<HTMLElement>();
  let found = 0;
  let filled = 0;
  // A value the site put in itself (a country taken from the job's location) is
  // the applicant's only when the profile agrees: one that contradicts it is answered again.
  const contradicted = checkPrefilled ? await prefilledAgainstProfile(within) : [];
  for (let round = 0; round < MAX_LEFTOVER_ROUNDS && found < MAX_LEFTOVER; round += 1) {
    if (late()) return stopAtDeadline(found, filled);
    markListOpeners();
    const { all, leftovers } = leftoverCandidates(tried, within);
    const fresh = round === 0 ? contradicted.filter((el) => !leftovers.includes(el)) : [];
    const batch = [...fresh, ...leftovers].slice(0, MAX_LEFTOVER - found);
    if (!batch.length) break;
    traceFromPage("leftover:candidates", () => ({
      round,
      all,
      picked: batch.map((el) => ({ id: el.id, label: fieldLabel(el), read: readControlValue(el) })),
    }));
    // The page is driven one dropdown at a time, but no dropdown waits on another's
    // answer: each one's options are read and its decision is sent at once, and the
    // answers are applied after they all came back.
    const planned: { el: HTMLElement; label: string; answer: Promise<LeftoverAnswer> }[] = [];
    for (const el of batch) {
      if (late()) return stopAtDeadline(found, filled);
      tried.add(el);
      const label = fieldLabel(el);
      const listed = await readListedOptions(el);
      planned.push({
        el,
        label,
        // A decision that fails is the one-by-one path, never a failed pass.
        answer: decideLeftover(label, listed).catch((): LeftoverAnswer => ({ kind: "live" })),
      });
    }
    const unanswered: HTMLElement[] = [];
    let answeredNow = 0;
    // Each dropdown is applied the moment its own answer is in: the first click does
    // not wait for the slowest decision of the others.
    for (const { el, label, answer } of planned) {
      if (late()) return stopAtDeadline(found, filled);
      if (await fillLeftover(el, label, await answer)) {
        filled += 1;
        answeredNow += 1;
      } else unanswered.push(el);
    }
    found += batch.length;
    // An answer changes what the lists after it hold (a state narrows the cities):
    // a list left unanswered is looked at again once another one was answered.
    if (answeredNow > 0) for (const el of unanswered) tried.delete(el);
  }
  return { found, filled };
}

/** The pass ran out of time: leave the rest and free the page. */
function stopAtDeadline(found: number, filled: number) {
  traceFromPage("leftover:deadline", () => ({ found, filled }));
  return { found, filled, stopped: true };
}

/** What one leftover dropdown lists when opened; long or remote lists are searched later. */
type ListedOptions = { labels: string[]; searchable: boolean };

/** How a leftover dropdown gets its answer, decided before the page is touched again. */
type LeftoverAnswer =
  /** An option of its list, picked by the decision model: selected with no further call. */
  | { kind: "option"; label: string }
  /** A long or remote list: the writer's estimate, typed as a search. */
  | { kind: "search"; estimate: Promise<string | null> }
  /** The whole list holds no option that is the applicant's answer: left as it is. */
  | { kind: "none" }
  /** Nothing decided ahead: the one-by-one path. */
  | { kind: "live" };

async function readListedOptions(el: HTMLElement): Promise<ListedOptions> {
  const target = resolveDropdownInteractionTarget(el);
  if (target instanceof HTMLSelectElement) {
    return { labels: realOptions(target).map(optionLabel).filter(Boolean), searchable: false };
  }
  const doc = target.ownerDocument || document;
  try {
    dismissOpenOverlays(doc, target);
    const options = await openAndCollectOptions(target, doc);
    return {
      labels: options.map(optionText).filter(Boolean),
      searchable: Boolean(resolveTypeableInput(target)),
    };
  } catch {
    return { labels: [], searchable: false };
  } finally {
    dismissOpenOverlays(doc, target);
  }
}

/** Starts the decision now; the promise resolves while later dropdowns are being read. */
async function decideLeftover(label: string, listed: ListedOptions): Promise<LeftoverAnswer> {
  const whole =
    listed.labels.length > 0 && (listed.labels.length <= JEV_LIST_MAX || !listed.searchable);
  if (whole) {
    // The whole list: a specific fact the profile holds (a city) that no option is
    // stays unanswered, never a different one; a category question still gets the
    // closest option.
    const ai = await askAiMatchOption({
      intendedValue: PROFILE_ANSWER,
      options: listed.labels,
      fieldLabel: label || null,
      typedQuery: null,
      allowNotListed: true,
      listComplete: true,
    });
    if (ai.matched_option) return { kind: "option", label: ai.matched_option };
    return ai.ok ? { kind: "none" } : { kind: "live" };
  }
  if (listed.searchable && label) {
    return { kind: "search", estimate: estimateOptionAnswer(label) };
  }
  return { kind: "live" };
}

async function fillLeftover(
  el: HTMLElement,
  label: string,
  answer: LeftoverAnswer,
): Promise<boolean> {
  if (answer.kind === "none") {
    traceFromPage("leftover:no-answer", () => ({ id: el.id, label }));
    return false;
  }
  // An empty dropdown counts as answered once it shows a value. One the site had
  // filled was picked again from the profile's option list: it may show the same
  // short value (a code shown for its country), and the pick itself is the answer.
  for (let attempt = 1; attempt <= LEFTOVER_FILL_ATTEMPTS; attempt += 1) {
    try {
      await applyLeftoverAnswer(el, label, answer);
    } catch (err) {
      traceFromPage("leftover:error", () => ({
        id: el.id,
        label,
        by: answer.kind,
        attempt,
        error: String(err),
      }));
      continue;
    }
    const read = readControlValue(el);
    if (read) {
      traceFromPage("leftover:filled", () => ({
        id: el.id,
        label,
        by: answer.kind,
        attempt,
        read,
      }));
      // Answered from the profile: later passes leave it, as they leave a plan's answers.
      rememberPlanFilled(el, undefined, read);
      return true;
    }
    traceFromPage("leftover:unfilled", () => ({ id: el.id, label, by: answer.kind, attempt }));
    dismissOpenOverlays(el.ownerDocument || document, resolveDropdownInteractionTarget(el));
  }
  return false;
}

async function applyLeftoverAnswer(
  el: HTMLElement,
  label: string,
  answer: LeftoverAnswer,
): Promise<void> {
  if (answer.kind === "option") {
    // An exact option label: the select path clicks it without asking again.
    await fillElement(el, answer.label, label || null);
    return;
  }
  // PROFILE_ANSWER is an instruction for the matcher, never a search query: a long
  // list types the writer's estimated answer instead.
  await fillElement(el, PROFILE_ANSWER, label || null, {
    estimateQuery: true,
    estimate: answer.kind === "search" ? answer.estimate : undefined,
    searchFirst: answer.kind === "search",
  });
}

/** Shown, enabled dropdowns the applicant can still change. */
function isOpenToAnswer(el: HTMLElement): boolean {
  if (!isCombobox(el) || !isDisplayed(el)) return false;
  if (el instanceof HTMLInputElement && (el.disabled || el.readOnly)) return false;
  if (el instanceof HTMLSelectElement && el.disabled) return false;
  return el.getAttribute("aria-disabled") !== "true";
}

/**
 * Dropdowns the site filled in itself whose value the applicant's profile
 * contradicts (a country or phone code taken from the job's location). The
 * profile's own answer for each field is written out, then compared with what the
 * field shows as the same fact or not, all at once. No answer, or an unanswered
 * comparison, keeps the value.
 */
async function prefilledAgainstProfile(
  within: ((el: Element) => boolean) | null,
): Promise<HTMLElement[]> {
  const prefilled = deepQueryAll(document, DROPDOWN_SELECTOR)
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .filter((el) => !within || within(el))
    .filter((el) => isOpenToAnswer(el) && !wasPlanFilled(el) && readControlValue(el) !== "")
    // Found to agree with the profile on an earlier pass, and still showing that value.
    .filter((el) => agreedValues.get(el) !== readControlValue(el))
    .slice(0, MAX_LEFTOVER);
  const judged = await Promise.all(
    prefilled.map(async (el) => {
      const label = fieldLabel(el);
      const current = readControlValue(el);
      if (!label) return null;
      const answer = await estimateOptionAnswer(label);
      if (!answer) return null;
      // One option, the field's own value: "not listed" means it is not the profile's answer.
      const ai = await askAiMatchOption({
        intendedValue: answer,
        options: [current],
        fieldLabel: label,
        typedQuery: null,
        allowNotListed: true,
      });
      const contradicts = ai.ok && !ai.matched_option;
      traceFromPage("leftover:prefilled", () => ({
        id: el.id,
        label,
        current,
        answer,
        contradicts,
      }));
      if (ai.ok && !contradicts) agreedValues.set(el, current);
      return contradicts ? el : null;
    }),
  );
  return judged.filter((el): el is HTMLElement => el != null);
}

/** Empty, enabled dropdowns no plan step answered and this pass has not tried. */
function leftoverCandidates(
  tried: Set<HTMLElement>,
  within: ((el: Element) => boolean) | null,
): { all: number; leftovers: HTMLElement[] } {
  // Custom elements keep their dropdown inputs in shadow roots: search those too.
  const nodes = deepQueryAll(document, DROPDOWN_SELECTOR)
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .filter((el) => !within || within(el));
  const leftovers = nodes.filter((el) => {
    if (tried.has(el) || !isOpenToAnswer(el)) return false;
    // The plan already answered this widget; a generic profile answer would overwrite it.
    if (wasPlanFilled(el)) return false;
    return !readControlValue(el);
  });
  return { all: nodes.length, leftovers };
}
