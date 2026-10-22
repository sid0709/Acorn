import { maskApiKey } from '../lib/mask-api-key';

function iso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value.trim() : d.toISOString();
  }
  return undefined;
}

/** Serialize Prisma / raw usage row for Athens AI Usage UI (mask apiKey). */
export function serializeAiUsageRow(
  doc: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!doc) return null;
  const { apiKey, id: _id, ...rest } = doc;
  return {
    ...rest,
    createdAt: iso(doc.createdAt) ?? doc.createdAt,
    startedAt: iso(doc.startedAt) ?? doc.startedAt,
    apiKey: maskApiKey(apiKey),
  };
}
