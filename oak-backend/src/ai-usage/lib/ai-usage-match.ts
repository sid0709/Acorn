import { toMongoDate } from '../../prisma/mongo-standalone';

export type AiUsageFilterInput = {
  since?: string;
  until?: string;
  applierName?: string;
  feature?: string;
  runId?: string;
};

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Prisma `where` for typed findMany. */
export function buildAiUsagePrismaWhere(query: AiUsageFilterInput = {}) {
  const applierName = String(query.applierName || '').trim() || undefined;
  const runId = String(query.runId || '').trim() || undefined;
  const feature = String(query.feature || '').trim() || undefined;
  const since = parseDate(query.since);
  const until = parseDate(query.until);

  return {
    ...(applierName ? { applierName } : {}),
    ...(runId ? { runId } : {}),
    ...(feature ? { feature } : {}),
    ...(since || until
      ? {
          createdAt: {
            ...(since ? { gte: since } : {}),
            ...(until ? { lte: until } : {}),
          },
        }
      : {}),
  };
}

/** Mongo `$match` for aggregateRaw (Extended JSON dates). */
export function buildAiUsageRawMatch(
  query: AiUsageFilterInput = {},
): Record<string, unknown> {
  const applierName = String(query.applierName || '').trim() || undefined;
  const runId = String(query.runId || '').trim() || undefined;
  const feature = String(query.feature || '').trim() || undefined;
  const since = parseDate(query.since);
  const until = parseDate(query.until);

  const match: Record<string, unknown> = {};
  if (applierName) match.applierName = applierName;
  if (runId) match.runId = runId;
  if (feature) match.feature = feature;
  if (since || until) {
    const createdAt: Record<string, unknown> = {};
    const gte = since ? toMongoDate(since) : null;
    const lte = until ? toMongoDate(until) : null;
    if (gte) createdAt.$gte = gte;
    if (lte) createdAt.$lte = lte;
    match.createdAt = createdAt;
  }
  return match;
}
