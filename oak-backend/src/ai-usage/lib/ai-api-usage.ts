/**
 * Canonical AI API usage entry builder — ported from packages/shared/src/ai-api-usage.js.
 * Does not store request/response text.
 */
import { randomUUID } from 'node:crypto';
import { costFromUsage, findPricing } from './pricing';

export type AiApiUsageRates = {
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
};

export function ratesForBilledModel(billedModel: string): AiApiUsageRates {
  const row = findPricing(billedModel);
  if (!row) {
    return { inputPer1M: 0, cachedInputPer1M: 0, outputPer1M: 0 };
  }
  return {
    inputPer1M: row.input,
    cachedInputPer1M: row.cachedInput ?? row.input,
    outputPer1M: row.output,
  };
}

export type BuildAiApiUsageEntryParams = {
  requestId?: string;
  feature?: string;
  provider: string;
  requestedModel?: string;
  billedModel?: string;
  apiKey?: string;
  rawUsage?: Record<string, unknown>;
  startedAt?: Date | string | number;
  durationMs: number;
  success?: boolean;
  httpStatus?: number;
  error?: string;
  runId?: string;
  applierName?: string;
  jobId?: string;
  path?: string;
};

/** Build an ai_api_usage document (without createdAt — recorder adds it). */
export function buildAiApiUsageEntry(
  params: BuildAiApiUsageEntryParams,
): Record<string, unknown> {
  const billed = String(
    params.billedModel || params.requestedModel || '',
  ).trim();
  const requested = String(params.requestedModel || billed || '').trim();
  const cost = costFromUsage(billed, params.rawUsage || {});
  const rates = ratesForBilledModel(billed);
  const started =
    params.startedAt instanceof Date
      ? params.startedAt
      : params.startedAt
        ? new Date(params.startedAt)
        : new Date(Date.now() - Math.max(0, Number(params.durationMs) || 0));

  const entry: Record<string, unknown> = {
    requestId: params.requestId || randomUUID(),
    feature: params.feature || 'unknown',
    provider: params.provider,
    requestedModel: requested,
    billedModel: billed,
    modelMismatch: requested !== '' && billed !== '' && requested !== billed,
    apiKey: String(params.apiKey || ''),
    inputTokens: cost.inputTokens,
    cachedInputTokens: cost.cachedTokens,
    outputTokens: cost.outputTokens,
    totalTokens: cost.totalTokens,
    costUsd: Math.round(cost.costUsd * 1_000_000) / 1_000_000,
    priced: cost.priced,
    rates,
    startedAt: started,
    durationMs: Math.max(0, Number(params.durationMs) || 0),
    success: Boolean(params.success ?? true),
  };

  if (params.runId) entry.runId = params.runId;
  if (params.applierName) entry.applierName = params.applierName;
  if (params.jobId) entry.jobId = params.jobId;
  if (params.path) entry.path = params.path;
  if (params.httpStatus != null) entry.httpStatus = params.httpStatus;
  if (params.error) entry.error = String(params.error).slice(0, 500);

  return entry;
}

export function tokensToRawUsage(params: {
  promptTokens?: number;
  cachedTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}): Record<string, unknown> {
  const promptTokens = params.promptTokens ?? 0;
  const cachedTokens = params.cachedTokens ?? 0;
  const completionTokens = params.completionTokens ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: params.totalTokens ?? promptTokens + completionTokens,
    prompt_tokens_details:
      cachedTokens > 0 ? { cached_tokens: cachedTokens } : undefined,
  };
}
