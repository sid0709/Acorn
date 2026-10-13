/** Searches from later words of an answer when it is not listed as written. */
const VARIANT_SEARCHES_MAX = 2;
/** A later-word search needs at least this many letters or digits to narrow anything. */
const VARIANT_MIN_CHARS = 3;

/**
 * Searches that start at a later word of the answer, longest first: a site may
 * list "The X of Y" as "X of Y". A bounded few, each long enough to narrow a list.
 */
export function laterWordQueries(value: string): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let start = 1; start < words.length && out.length < VARIANT_SEARCHES_MAX; start += 1) {
    const variant = words.slice(start).join(" ");
    if (variant.replace(/[^\p{L}\p{N}]/gu, "").length >= VARIANT_MIN_CHARS) out.push(variant);
  }
  return out;
}
