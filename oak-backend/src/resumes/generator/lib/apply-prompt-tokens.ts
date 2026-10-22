import { cleanString } from './clean-string';

/** Substitute `{token}` placeholders; unknown `{companyN}` become empty strings. */
export function applyPromptTokens(
  text: unknown,
  tokenMap: Record<string, string>,
): string {
  const unresolved = new Set<string>();
  const map = { ...tokenMap };
  // Prompts may reference {companyN} beyond the profile length; treat missing
  // roles as empty rather than failing the whole run.
  for (const match of cleanString(text).matchAll(/\{company(\d+)\}/gi)) {
    const key = `company${match[1]}`;
    if (!Object.prototype.hasOwnProperty.call(map, key)) map[key] = '';
  }
  const resolved = cleanString(text).replace(/\{[a-z0-9_]+\}/gi, (match) => {
    const key = match.slice(1, -1).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      return map[key];
    }
    unresolved.add(match);
    return match;
  });
  if (unresolved.size) {
    throw Object.assign(
      new Error(
        `Unresolved prompt token${unresolved.size === 1 ? '' : 's'}: ${[...unresolved].join(', ')}.`,
      ),
      { status: 400 },
    );
  }
  return resolved;
}
