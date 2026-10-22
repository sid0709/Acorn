import {
  EMPTY_AI_USAGE_TOTALS,
  type AiUsageTotals,
} from '../constants/ai-usage.constants';
import { roundCostUsd } from '../lib/mask-api-key';

export type AiUsageBucket = AiUsageTotals & {
  lastCallAt: string | null;
  byProvider: Array<{
    provider: string;
    billedModel: string;
    calls: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  }>;
  byFeature: Array<{
    feature: string;
    calls: number;
    costUsd: number;
    totalTokens: number;
  }>;
};

export function emptyUsageBucket(): AiUsageBucket {
  return {
    ...EMPTY_AI_USAGE_TOTALS,
    lastCallAt: null,
    byProvider: [],
    byFeature: [],
  };
}

export function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value.trim() : d.toISOString();
  }
  if (typeof value === 'object' && value !== null && '$date' in value) {
    return isoOrNull((value as { $date?: unknown }).$date);
  }
  return null;
}

/** Fold aggregate rows into per-applier usage buckets. */
export function buildUsageByName(input: {
  byApplier: Record<string, unknown>[];
  byApplierProvider: Record<string, unknown>[];
  byApplierFeature: Record<string, unknown>[];
}): Map<string, AiUsageBucket> {
  const usageByName = new Map<string, AiUsageBucket>();

  for (const row of input.byApplier) {
    const name = String(row._id || '').trim();
    usageByName.set(name, {
      calls: Number(row.calls) || 0,
      inputTokens: Number(row.inputTokens) || 0,
      cachedInputTokens: Number(row.cachedInputTokens) || 0,
      outputTokens: Number(row.outputTokens) || 0,
      totalTokens: Number(row.totalTokens) || 0,
      costUsd: roundCostUsd(row.costUsd),
      lastCallAt: isoOrNull(row.lastCallAt),
      byProvider: [],
      byFeature: [],
    });
  }

  for (const row of input.byApplierProvider) {
    const id = row._id as Record<string, unknown> | undefined;
    const name = String(id?.applierName || '').trim();
    const bucket = usageByName.get(name) || emptyUsageBucket();
    if (!usageByName.has(name)) usageByName.set(name, bucket);
    bucket.byProvider.push({
      provider: String(id?.provider || 'unknown'),
      billedModel: String(id?.billedModel || 'unknown'),
      calls: Number(row.calls) || 0,
      inputTokens: Number(row.inputTokens) || 0,
      cachedInputTokens: Number(row.cachedInputTokens) || 0,
      outputTokens: Number(row.outputTokens) || 0,
      totalTokens: Number(row.totalTokens) || 0,
      costUsd: roundCostUsd(row.costUsd),
    });
  }

  for (const row of input.byApplierFeature) {
    const id = row._id as Record<string, unknown> | undefined;
    const name = String(id?.applierName || '').trim();
    const bucket = usageByName.get(name) || emptyUsageBucket();
    if (!usageByName.has(name)) usageByName.set(name, bucket);
    bucket.byFeature.push({
      feature: String(id?.feature || 'unknown'),
      calls: Number(row.calls) || 0,
      costUsd: roundCostUsd(row.costUsd),
      totalTokens: Number(row.totalTokens) || 0,
    });
  }

  return usageByName;
}
