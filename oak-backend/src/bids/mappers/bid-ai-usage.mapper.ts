/** Serialize bid-scoped AI usage rows to the Athens Bid Management contract. */

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function text(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value.trim() : d.toISOString();
  }
  if (typeof value === 'object' && value !== null && '$date' in value) {
    return iso((value as { $date?: unknown }).$date);
  }
  return null;
}

function idOf(doc: Record<string, unknown>, fallback: string): string {
  const raw = doc._id ?? doc.id;
  if (raw == null) return fallback;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw === 'object' && raw !== null && '$oid' in raw) {
    const oid = (raw as { $oid?: unknown }).$oid;
    if (typeof oid === 'string' && oid.trim()) return oid.trim();
  }
  return fallback;
}

/**
 * Flatten an `ai_api_usage` / vendor-task usage document into the Bid
 * Management `BidAiUsageRow` shape (matches Athens-server serializeAiUsageRow).
 */
export function serializeBidAiUsageRow(
  doc: Record<string, unknown> | null | undefined,
  fallbackId: string,
): Record<string, unknown> | null {
  if (!doc || typeof doc !== 'object') return null;

  const nested =
    doc.usage && typeof doc.usage === 'object' && !Array.isArray(doc.usage)
      ? (doc.usage as Record<string, unknown>)
      : null;
  const u = nested ?? doc;

  const inputTokens = num(u.inputTokens ?? u.promptTokens ?? u.prompt_tokens);
  const cachedInputTokens = num(
    u.cachedInputTokens ?? u.cachedTokens ?? u.cached_tokens,
  );
  const outputTokens = num(
    u.outputTokens ?? u.completionTokens ?? u.completion_tokens,
  );
  const totalTokens = num(
    u.totalTokens ?? u.total_tokens ?? inputTokens + outputTokens,
  );
  const costRaw = u.costUsd ?? u.cost;
  const costUsd =
    typeof costRaw === 'number' && Number.isFinite(costRaw) ? costRaw : null;

  return {
    id: idOf(doc, fallbackId),
    requestId: text(doc.requestId ?? u.requestId, 200) ?? text(fallbackId, 200),
    feature: text(doc.feature, 120),
    provider: text(doc.provider ?? u.provider, 80),
    requestedModel: text(
      doc.requestedModel ?? u.requestedModel ?? u.model,
      200,
    ),
    billedModel: text(doc.billedModel ?? u.billedModel ?? u.model, 200),
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    costUsd,
    success: doc.success !== false && u.success !== false,
    durationMs:
      typeof doc.durationMs === 'number' && Number.isFinite(doc.durationMs)
        ? doc.durationMs
        : typeof u.durationMs === 'number' && Number.isFinite(u.durationMs)
          ? u.durationMs
          : null,
    applierName: text(doc.applierName, 200),
    jobId: text(doc.jobId, 200),
    createdAt: iso(doc.createdAt ?? doc.at ?? u.at),
  };
}

/** Build a usage row from VendorTask embedded analysis/recommend usage JSON. */
export function rowFromVendorEmbeddedUsage(input: {
  feature: string;
  usage: unknown;
  requestId?: string | null;
  at?: Date | string | null;
  applierName: string;
  jobId: string;
  id: string;
}): Record<string, unknown> | null {
  if (!input.usage || typeof input.usage !== 'object') return null;
  return serializeBidAiUsageRow(
    {
      id: input.id,
      feature: input.feature,
      requestId: input.requestId ?? null,
      applierName: input.applierName,
      jobId: input.jobId,
      createdAt: input.at ?? null,
      usage: input.usage,
    },
    input.id,
  );
}
