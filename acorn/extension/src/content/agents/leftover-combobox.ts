import { traceFromPage } from "../../debug-trace";
import { fieldWrapper, groupQuestion } from "../form-dom";

import { fillElement } from "./fill";
import { wasPlanFilled } from "./plan-fill-registry";
import { readControlValue } from "./read-control-value";

/** Planner-less leftover controls: matcher AI answers from the applicant profile. */
const PROFILE_ANSWER = "Answer from the applicant profile";
/** Dropdowns the plan did not answer (in fast fill: every custom dropdown). */
const MAX_LEFTOVER = 40;
/** Look-again rounds for dropdowns that earlier answers revealed. */
const MAX_LEFTOVER_ROUNDS = 3;

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

function fieldLabel(el: HTMLElement): string {
  const labelled = el.getAttribute("aria-labelledby");
  if (labelled) {
    const parts = labelled
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent?.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  const aria = el.getAttribute("aria-label")?.replace(/\s+/g, " ").trim();
  if (aria) return aria;
  if (el.id) {
    const forLabel = el.ownerDocument
      .querySelector(`label[for="${CSS.escape(el.id)}"]`)
      ?.textContent?.replace(/\s+/g, " ")
      .trim();
    if (forLabel) return forLabel;
  }
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
    for (const el of batch) {
      tried.add(el);
      if (await fillLeftover(el)) filled += 1;
    }
    found += batch.length;
  }
  return { found, filled };
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

async function fillLeftover(el: HTMLElement): Promise<boolean> {
  const label = fieldLabel(el);
  try {
    // PROFILE_ANSWER is an instruction for the matcher, never a search query: a long
    // list types the writer's estimated answer instead.
    await fillElement(el, PROFILE_ANSWER, label || null, { estimateQuery: true });
    traceFromPage("leftover:filled", () => ({ id: el.id, label, read: readControlValue(el) }));
    return Boolean(readControlValue(el));
  } catch (err) {
    traceFromPage("leftover:error", () => ({ id: el.id, label, error: String(err) }));
    return false;
  }
}
