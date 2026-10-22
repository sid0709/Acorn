import { normalizeJobIdentityText } from './job-identity';

export function asObjectIdHex(value: unknown): string | null {
  if (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value))
    return value;
  if (value && typeof value === 'object' && '$oid' in value) {
    const oid = (value as { $oid?: unknown }).$oid;
    return typeof oid === 'string' && /^[a-fA-F0-9]{24}$/.test(oid)
      ? oid
      : null;
  }
  return null;
}

export function pickRawId(raw: unknown): { id: string } | null {
  const rows = Array.isArray(raw) ? raw : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = asObjectIdHex((row as { _id?: unknown })._id);
    if (id) return { id };
  }
  return null;
}

/**
 * Regex with `i` can over-match Unicode edge cases; confirm with NFKC keys.
 */
export function pickIdentityHit(
  raw: unknown,
  companyKey: string,
  titleKey: string,
): { id: string } | null {
  const rows = Array.isArray(raw) ? raw : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const doc = row as {
      _id?: unknown;
      companyName?: unknown;
      title?: unknown;
    };
    if (
      normalizeJobIdentityText(doc.companyName) !== companyKey ||
      normalizeJobIdentityText(doc.title) !== titleKey
    ) {
      continue;
    }
    const id = asObjectIdHex(doc._id);
    if (id) return { id };
  }
  return null;
}
