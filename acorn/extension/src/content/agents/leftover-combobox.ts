import { traceFromPage } from "../../debug-trace";
import { fieldWrapper, groupQuestion } from "../form-dom";
import { forLabelOf, uniqueById } from "../verify/element-labels";

import { JEV_LIST_MAX } from "./combobox/choose-option";
import { estimateOptionAnswer } from "./combobox/estimate-client";
import { optionText } from "./combobox/options-dom";
import { openAndCollectOptions } from "./combobox/options-wait";
import { dismissOpenOverlays, resolveTypeableInput } from "./combobox/typing";
import { resolveDropdownInteractionTarget } from "./enhanced-select";
import { fillElement } from "./fill";
import { askAiMatchOption } from "./match-option-client";
import { optionLabel, realOptions } from "./native-select";
import { wasPlanFilled } from "./plan-fill-registry";
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
    el.getAttribute("aria-haspopup") === "listbox"
  );
}

/**
 * A dropdown's name, with its question: a control inside a fieldset is asked the
 * fieldset's legend (HTML's own label for a group), which a bare name such as
 * "Select One" leaves out.
 */
function fieldLabel(el: HTMLElement): string {
  const own = ownLabel(el);
  const legend = el
    .closest("fieldset")
    ?.querySelector("legend")
    ?.textContent?.replace(/\s+/g, " ")
    .trim();
  if (!legend || own.toLowerCase().includes(legend.toLowerCase())) return own;
  return own ? `${legend} — ${own}` : legend;
}

function ownLabel(el: HTMLElement): string {
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
  return groupQuestion(fieldWrapper(el), el, [el]);
}

export async function fillLeftoverComboboxes(): Promise<{
  found: number;
  filled: number;
}> {
  // Answers reveal follow-up dropdowns (a race list after "Hispanic or Latino?"),
  // so look again after each round for empty ones not tried yet.
  const tried = new Set<HTMLElement>();
  let found = 0;
  let filled = 0;
  for (let round = 0; round < MAX_LEFTOVER_ROUNDS && found < MAX_LEFTOVER; round += 1) {
    const { all, leftovers } = leftoverCandidates(tried);
    const batch = leftovers.slice(0, MAX_LEFTOVER - found);
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
      tried.add(el);
      const label = fieldLabel(el);
      const listed = await readListedOptions(el);
      planned.push({ el, label, answer: decideLeftover(label, listed) });
    }
    const answers = await Promise.all(planned.map((row) => row.answer));
    for (const [i, { el, label }] of planned.entries()) {
      if (await fillLeftover(el, label, answers[i])) filled += 1;
    }
    found += batch.length;
  }
  return { found, filled };
}

/** What one leftover dropdown lists when opened; long or remote lists are searched later. */
type ListedOptions = { labels: string[]; searchable: boolean };

/** How a leftover dropdown gets its answer, decided before the page is touched again. */
type LeftoverAnswer =
  /** An option of its list, picked by the decision model: selected with no further call. */
  | { kind: "option"; label: string }
  /** A long or remote list: the writer's estimate, typed as a search. */
  | { kind: "search"; estimate: Promise<string | null> }
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
    const ai = await askAiMatchOption({
      intendedValue: PROFILE_ANSWER,
      options: listed.labels,
      fieldLabel: label || null,
      typedQuery: null,
      allowNotListed: false,
    });
    const picked = ai.matched_option || ai.fallback_option;
    return picked ? { kind: "option", label: picked } : { kind: "live" };
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

/** Empty, enabled dropdowns no plan step answered and this pass has not tried. */
function leftoverCandidates(tried: Set<HTMLElement>): { all: number; leftovers: HTMLElement[] } {
  const nodes = Array.from(
    document.querySelectorAll('[role="combobox"], select, [aria-haspopup="listbox"]'),
  ).filter((node): node is HTMLElement => node instanceof HTMLElement);
  const leftovers = nodes.filter((el) => {
    if (tried.has(el) || !isCombobox(el) || !isDisplayed(el)) return false;
    if (el instanceof HTMLInputElement && (el.disabled || el.readOnly)) return false;
    if (el instanceof HTMLSelectElement && el.disabled) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    // The plan already answered this widget; a generic profile answer would overwrite it.
    if (wasPlanFilled(el)) return false;
    return !readControlValue(el);
  });
  return { all: nodes.length, leftovers };
}
