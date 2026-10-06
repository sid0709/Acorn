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

/**
 * One AI decision over exactly these candidates. The matcher returns null when the
 * intended answer is not among them, and that is final for this list.
 */
export async function decideAmongOptions(
  options: HTMLElement[],
  value: string,
  fieldLabel: string | null,
  typedQuery: string | null,
): Promise<HTMLElement | null> {
  if (!options.length || !value.trim()) return null;
  const ai = await askAiMatchOption({
    intendedValue: value,
    options: options.map(optionText),
    fieldLabel,
    typedQuery,
  });
  return ai.matched_option ? resolveOptionElement(options, ai.matched_option) : null;
}
