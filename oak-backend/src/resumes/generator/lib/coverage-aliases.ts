import { STATIC_ALIASES, toCanonical } from '@nextoffer/shared/skill-normalize';
import { cleanString } from './clean-string';

function technologyTokenKind(
  token: string,
  tokenCount: number,
): 'core' | 'modifier' | null {
  const value = cleanString(token).replace(/^[('-]+|[)'-]+$/g, '');
  if (!value) return null;
  if (/^\d+(?:\.\d+)*$/.test(value)) return 'modifier';
  if (/[-.#+]/.test(value) && /[a-z]/i.test(value)) return 'core';
  if (/^(?=.*[A-Z])[A-Z0-9]+s?$/.test(value)) return 'core';
  if (
    /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(value) &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value)
  ) {
    return 'core';
  }
  if (/^[a-z]{1,4}$/.test(value)) return tokenCount === 1 ? 'core' : 'modifier';
  return null;
}

export function isNamedTechnologySurface(value: unknown): boolean {
  const name = cleanString(value);
  if (!name || name.length > 100 || /[,;]/.test(name)) return false;
  const tokens = name.match(/[A-Za-z0-9][A-Za-z0-9.+#'-]*/g) || [];
  if (!tokens.length) return false;
  const kinds = tokens.map((token) =>
    technologyTokenKind(token, tokens.length),
  );
  return kinds.every(Boolean) && kinds.includes('core');
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function aliasVariants(alias: unknown): string[] {
  const value = cleanString(alias);
  if (!value) return [];
  const variants = new Set([value]);
  const words = value.split(/\s+/);
  const last = words.at(-1) || '';
  if (/^[a-z][a-z -]{2,}$/i.test(value) && last.length > 3) {
    if (/ies$/i.test(last)) {
      variants.add([...words.slice(0, -1), `${last.slice(0, -3)}y`].join(' '));
    } else if (/s$/i.test(last) && !/ss$/i.test(last)) {
      variants.add([...words.slice(0, -1), last.slice(0, -1)].join(' '));
    } else {
      variants.add([...words.slice(0, -1), `${last}s`].join(' '));
    }
  }
  return [...variants];
}

function phrasePattern(alias: string): RegExp | null {
  const parts = cleanString(alias)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .match(/[a-z0-9]+(?:[+#]+)?/g);
  if (!parts?.length) return null;
  const body = parts.map(regexEscape).join('[\\s./_\\-]*');
  return new RegExp(`(?:^|[^a-z0-9+#])${body}(?=$|[^a-z0-9+#])`, 'iu');
}

function phraseSurfacePattern(alias: string): RegExp | null {
  const parts = cleanString(alias)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .match(/[a-z0-9]+(?:[+#]+)?/g);
  if (!parts?.length) return null;
  const body = parts.map(regexEscape).join('[\\s./_\\-]*');
  return new RegExp(`(?:^|[^a-z0-9+#])(${body})(?=$|[^a-z0-9+#])`, 'giu');
}

function configuredAliases(
  name: string,
  aliases: Record<string, string[]> | null | undefined,
): string[] {
  if (!aliases || typeof aliases !== 'object') return [];
  const canonical = toCanonical(name);
  const out: string[] = [];
  for (const [key, values] of Object.entries(aliases)) {
    if (toCanonical(key) !== canonical || !Array.isArray(values)) continue;
    out.push(...values.map(cleanString).filter(Boolean));
  }
  return out;
}

type SkillLike = string | { name?: unknown; aliases?: unknown };

export function aliasesForCoverageSkill(
  skill: SkillLike,
  aliases: Record<string, string[]> = {},
): string[] {
  const name = cleanString(typeof skill === 'string' ? skill : skill?.name);
  const supplied = Array.isArray(
    typeof skill === 'string' ? undefined : skill?.aliases,
  )
    ? (skill as { aliases: unknown[] }).aliases
    : [];
  const canonical = toCanonical(name);
  const builtIn = STATIC_ALIASES[canonical] || [];
  return [
    ...new Set(
      [name, ...supplied, ...builtIn, ...configuredAliases(name, aliases)]
        .flatMap(aliasVariants)
        .map(cleanString)
        .filter(Boolean),
    ),
  ].slice(0, 30);
}

export function textContainsCoverageSkill(
  text: unknown,
  skill: SkillLike,
  aliases: Record<string, string[]> = {},
): boolean {
  const haystack = String(text ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US');
  if (!haystack) return false;
  return aliasesForCoverageSkill(skill, aliases).some((alias) => {
    const pattern = phrasePattern(alias);
    return pattern ? pattern.test(haystack) : false;
  });
}

/**
 * A coverage item must be grounded in the JD and look like a real name in the
 * JD's original casing (prevents "data modeling" → "Data Modeling").
 */
export function isNamedResumeCoverageSkill(
  skill: SkillLike,
  jobDescription: unknown,
  aliases: Record<string, string[]> = {},
): boolean {
  const name = cleanString(typeof skill === 'string' ? skill : skill?.name);
  if (!isNamedTechnologySurface(name)) return false;
  const text = String(jobDescription ?? '').normalize('NFKC');
  if (!text) return false;
  return aliasesForCoverageSkill(skill, aliases).some((alias) => {
    const pattern = phraseSurfacePattern(alias);
    if (!pattern) return false;
    return [...text.matchAll(pattern)].some((match) =>
      isNamedTechnologySurface(match[1]),
    );
  });
}
