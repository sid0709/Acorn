/**
 * Canonical AI API usage log for the Firestore `ai_api_usage` collection.
 * Written only by ai-bff — never stores request/response text.
 */

import { randomUUID } from 'node:crypto';
import { costFromUsage, findPricing, parsePromptUsage } from './pricing.js';

export const AI_API_USAGE_COLLECTION = 'ai_api_usage';

/**
 * @param {string} billedModel
 */
export function ratesForBilledModel(billedModel) {
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

/**
 * Build an ai_api_usage document (without createdAt — recorder adds it).
 * Does not include prompt/response text.
 */
export function buildAiApiUsageEntry({
  requestId,
  feature,
  provider,
  requestedModel,
  billedModel,
  apiKey,
  rawUsage,
  startedAt,
  durationMs,
  success = true,
  httpStatus,
  error,
  runId,
  applierName,
  jobId,
  path,
}) {
  const billed = String(billedModel || requestedModel || '').trim();
  const requested = String(requestedModel || billed || '').trim();
  const cost = costFromUsage(billed, rawUsage || {});
  const rates = ratesForBilledModel(billed);
  const started =
    startedAt instanceof Date
      ? startedAt
      : startedAt
        ? new Date(startedAt)
        : new Date(Date.now() - Math.max(0, Number(durationMs) || 0));

  /** @type {Record<string, unknown>} */
  const entry = {
    requestId: requestId || randomUUID(),
    feature: feature || 'unknown',
    provider,
    requestedModel: requested,
    billedModel: billed,
    modelMismatch: requested !== '' && billed !== '' && requested !== billed,
    apiKey: String(apiKey || ''),
    inputTokens: cost.inputTokens,
    cachedInputTokens: cost.cachedTokens,
    outputTokens: cost.outputTokens,
    totalTokens: cost.totalTokens,
    costUsd: Math.round(cost.costUsd * 1_000_000) / 1_000_000,
    priced: cost.priced,
    rates,
    startedAt: started,
    durationMs: Math.max(0, Number(durationMs) || 0),
    success: Boolean(success),
  };

  if (runId) entry.runId = runId;
  if (applierName) entry.applierName = applierName;
  if (jobId) entry.jobId = jobId;
  if (path) entry.path = path;
  if (httpStatus != null) entry.httpStatus = httpStatus;
  if (error) entry.error = String(error).slice(0, 500);

  return entry;
}

/**
 * @param {{ createIndex: Function }} collection
 */
export async function ensureAiApiUsageIndexes(collection) {
  await collection.createIndex({ createdAt: -1 });
  await collection.createIndex({ applierName: 1, createdAt: -1 });
  await collection.createIndex({ apiKey: 1, createdAt: -1 });
  await collection.createIndex({ feature: 1, createdAt: -1 });
  await collection.createIndex({ provider: 1, billedModel: 1, createdAt: -1 });
  await collection.createIndex({ runId: 1 });
  await collection.createIndex({ requestId: 1 }, { unique: true });
}

/**
 * @param {{ insertOne: Function } | null | undefined} collection
 */
export function createAiApiUsageRecorder(collection) {
  return async function recordAiApiUsage(entry) {
    if (!collection) return null;
    const doc = { ...entry, createdAt: new Date() };
    await collection.insertOne(doc);
    return doc;
  };
}

/**
 * Build raw usage object from normalized token counts.
 */
export function tokensToRawUsage({
  promptTokens = 0,
  cachedTokens = 0,
  completionTokens = 0,
  totalTokens,
}) {
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens ?? promptTokens + completionTokens,
    prompt_tokens_details:
      cachedTokens > 0 ? { cached_tokens: cachedTokens } : undefined,
  };
}

export { parsePromptUsage, costFromUsage };
