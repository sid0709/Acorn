import type { IdentityQuestion } from './applicant-identity';
import { IDENTITY_KIND_APPLICATION_AI } from './oak-identity-prompt';

export function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error('Identity classifier returned no JSON object');
}

export function parseApplicationAiIndexes(
  text: string,
  fields: IdentityQuestion[],
): Set<number> {
  const allowed = new Set(fields.map((field) => field.elementIndex));
  const parsed = JSON.parse(extractJsonObject(text)) as {
    classifications?: unknown;
  };
  const rows = Array.isArray(parsed.classifications)
    ? parsed.classifications
    : [];
  const indexes = new Set<number>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as { element_index?: unknown; kind?: unknown };
    const index =
      typeof item.element_index === 'number'
        ? item.element_index
        : Number(item.element_index);
    if (!allowed.has(index)) continue;
    if (item.kind === IDENTITY_KIND_APPLICATION_AI) indexes.add(index);
  }
  return indexes;
}
