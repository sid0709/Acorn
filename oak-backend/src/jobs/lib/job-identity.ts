/** Canonical company/title text for cross-source identity dedupe. */
export function normalizeJobIdentityText(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : value == null
        ? ''
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : '';
  return text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function buildJobIdentityKeys(
  companyName: unknown,
  title: unknown,
): { companyKey: string; titleKey: string } | null {
  const companyKey = normalizeJobIdentityText(companyName);
  const titleKey = normalizeJobIdentityText(title);
  if (!companyKey || !titleKey) return null;
  return { companyKey, titleKey };
}

/** Escape a string for safe use inside a Mongo `$regex`. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Mongo regex for a normalized identity key; allows extra surrounding / inner whitespace. */
export function identityRegexPattern(key: string): string {
  const parts = key
    .split(' ')
    .map((part) => escapeRegex(part))
    .filter(Boolean);
  if (!parts.length) return '';
  return `^\\s*${parts.join('\\s+')}\\s*$`;
}
