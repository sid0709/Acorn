import { askAiMatchOption } from "../match-option-client";
import { stripChoiceMarker } from "../string-similarity";

import { normalize, optionText } from "./options-dom";

/** The option whose text is the value (ignoring case, spacing, and an "A." style marker). */
export function findExactOption(options: HTMLElement[], value: string): HTMLElement | null {
  const target = normalize(value);
  const targetBare = normalize(stripChoiceMarker(value));
  if (!target) return null;
  return (
    options.find((opt) => {
      const have = normalize(optionText(opt));
      return have === target || normalize(stripChoiceMarker(optionText(opt))) === targetBare;
    }) ?? null
  );
}

function optionKey(text: string): string {
  return normalize(stripChoiceMarker(text))
    .replace(/[^\p{L}\p{N}+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveOptionElement(options: HTMLElement[], label: string): HTMLElement | null {
  const want = optionKey(label);
  return (
    options.find((opt) => optionText(opt) === label) ||
    options.find((opt) => normalize(optionText(opt)) === normalize(label)) ||
    (want ? options.find((opt) => optionKey(optionText(opt)) === want) || null : null)
  );
}

export type OptionDecision = {
  /** The option to select; null only when "not listed" was allowed and chosen. */
  match: HTMLElement | null;
  /** The best listed option, usable when the list cannot be searched further. */
  fallback: HTMLElement | null;
};

const NO_DECISION: OptionDecision = { match: null, fallback: null };

/**
 * One SelectorGateway (Jev) decision over exactly these options. Without
 * `allowNotListed` it always picks one: the option that means the value, or the
 * closest one an applicant would choose (a broader category, or "Other").
 */
export async function decideAmongOptions(
  options: HTMLElement[],
  value: string,
  fieldLabel: string | null,
  typedQuery: string | null,
  allowNotListed: boolean,
): Promise<OptionDecision> {
  if (!options.length || !value.trim()) return NO_DECISION;
  const ai = await askAiMatchOption({
    intendedValue: value,
    options: options.map(optionText),
    fieldLabel,
    typedQuery,
    allowNotListed,
  });
  return {
    match: ai.matched_option ? resolveOptionElement(options, ai.matched_option) : null,
    fallback: ai.fallback_option ? resolveOptionElement(options, ai.fallback_option) : null,
  };
}
