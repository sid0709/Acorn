/**
 * Choice fields whose options are already in the page (native selects, radio,
 * Yes/No and checkbox groups) and whose planned value is not an exact option.
 * The background decides them all in one SelectorGateway (Jev) batch after
 * uploads finish, then the steps click exact labels with no per-field decision.
 * Custom dropdowns are left out: their options only exist once opened.
 */

import { checkboxLabels, singleChoiceLabels } from "./agents/choice-decision";
import { optionLabel, realOptions } from "./agents/native-select";
import { groupRoot } from "./agents/select-radio";
import { resolveElementByNodeId } from "./element-resolver";
import { inferRole } from "./verify/element-role";

export type ChoiceBatchStep = {
  index: number;
  element_index: number;
  expected_label: string | null;
  value: string;
};

export type ChoiceBatchItem = {
  /** The plan step index the decision rewrites. */
  id: number;
  field: string;
  intended: string;
  options: string[];
  multiple: boolean;
};

const BOOLEAN_INTENT = /^(true|yes|1|on|checked|false|no|0|off|unchecked)$/i;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function isGroupTarget(el: Element): boolean {
  const role = inferRole(el);
  if (el instanceof HTMLInputElement) return el.type === "radio" || el.type === "checkbox";
  return ["radio", "checkbox", "radiogroup", "group"].includes(role) || el.tagName === "FIELDSET";
}

function optionsFor(el: Element, value: string): { options: string[]; multiple: boolean } | null {
  if (el instanceof HTMLSelectElement) {
    if (el.multiple) return null;
    return { options: realOptions(el).map(optionLabel), multiple: false };
  }
  if (!isGroupTarget(el)) return null;
  const root = groupRoot(el as HTMLElement);
  const boxes = checkboxLabels(root);
  if (boxes.length > 1) {
    return BOOLEAN_INTENT.test(value.trim()) ? null : { options: boxes, multiple: true };
  }
  const singles = singleChoiceLabels(root);
  return singles.length > 1 ? { options: singles, multiple: false } : null;
}

function alreadyExact(value: string, options: string[], multiple: boolean): boolean {
  const labels = new Set(options.map(normalize));
  const parts = multiple ? value.split(/\s*,\s*/) : [value];
  return parts.every((part) => labels.has(normalize(part)));
}

/** The planned choice steps that still need a decision, with their live options. */
export function collectChoiceItems(steps: ChoiceBatchStep[]): ChoiceBatchItem[] {
  const items: ChoiceBatchItem[] = [];
  const seenGroups = new Set<ParentNode>();
  for (const step of steps) {
    const el = resolveElementByNodeId(step.element_index);
    if (!el || !step.value.trim()) continue;
    const found = optionsFor(el, step.value);
    if (!found || !found.options.length || alreadyExact(step.value, found.options, found.multiple))
      continue;
    if (found.multiple) {
      // One decision per checkbox group, however many steps the plan spent on it.
      const root = groupRoot(el as HTMLElement);
      if (seenGroups.has(root)) continue;
      seenGroups.add(root);
    }
    items.push({
      id: step.index,
      field: step.expected_label || "",
      intended: step.value,
      options: found.options,
      multiple: found.multiple,
    });
  }
  return items;
}
