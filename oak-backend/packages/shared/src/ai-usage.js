/**
 * Canonical AI call log schema and recorder for llm_call_log collection.
 */

import { randomUUID } from 'node:crypto';
import { costFromUsage, findPricing, parsePromptUsage } from './pricing.js';

export const LLM_CALL_LOG_COLLECTION = 'llm_call_log';

/** @typedef {'ai-bff' | 'athens-server'} AiUsageService */
/** @typedef {'openai' | 'deepseek' | 'ollama'} AiUsageProvider */

/**
 * @param {Record<string, unknown>} rawUsage
 */
export function normalizeRawUsage(rawUsage) {
  return parsePromptUsage(rawUsage || {});
}

/**
 * Compute cost from billed model and raw provider usage object.
 * @param {string} billedModel
 * @param {Record<string, unknown>} rawUsage
 */
export function calculateBilledCost(billedModel, rawUsage) {
  return costFromUsage(billedModel, rawUsage);
}

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
 * Build a validated llm_call_log document (without createdAt).
 * @param {object} params
 * @param {string} [params.requestId]
 * @param {string} params.service
 * @param {string} params.feature
 * @param {string} params.provider
 * @param {string} params.requestedModel
 * @param {string} params.billedModel
 * @param {Record<string, unknown>} params.rawUsage
 * @param {number} params.durationMs
 * @param {boolean} [params.success]
 * @param {number} [params.httpStatus]
 * @param {string} [params.error]
 * @param {string} [params.runId]
 * @param {string} [params.applierName]
 * @param {string} [params.jobId]
 * @param {string} [params.path]
 */
export function buildCallLogEntry({
  requestId,
  service,
  feature,
  provider,
  requestedModel,
  billedModel,
  rawUsage,
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
  const cost = calculateBilledCost(billed, rawUsage || {});
  const rates = ratesForBilledModel(billed);

  /** @type {Record<string, unknown>} */
  const entry = {
    requestId: requestId || randomUUID(),
    service,
    feature: feature || 'unknown',
    provider,
    requestedModel: requested,
    billedModel: billed,
    modelMismatch: requested !== '' && billed !== '' && requested !== billed,
    inputTokens: cost.inputTokens,
    cachedInputTokens: cost.cachedTokens,
    outputTokens: cost.outputTokens,
    totalTokens: cost.totalTokens,
    costUsd: Math.round(cost.costUsd * 1_000_000) / 1_000_000,
    priced: cost.priced,
    rates,
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
 * Create indexes for llm_call_log (idempotent).
 * @param {{ createIndex: Function }} collection
 */
export async function ensureCallLogIndexes(collection) {
  await collection.createIndex({ createdAt: -1 });
  await collection.createIndex({ applierName: 1, createdAt: -1 });
  await collection.createIndex({ runId: 1 });
  await collection.createIndex({ feature: 1, createdAt: -1 });
  await collection.createIndex({ provider: 1, billedModel: 1, createdAt: -1 });
  await collection.createIndex({ requestId: 1 }, { unique: true });
}

/**
 * @param {{ insertOne: Function } | null | undefined} collection
 */
export function createCallLogRecorder(collection) {
  return async function recordCallLog(entry) {
    if (!collection) return null;
    const doc = { ...entry, createdAt: new Date() };
    await collection.insertOne(doc);
    return doc;
  };
}

/**
 * Parse correlation headers from an Express/Node request.
 * @param {import('express').Request | { headers?: Record<string, string | string[] | undefined> }} req
 */
export function parseCorrelationHeaders(req) {
  const headers = req?.headers || {};
  const get = (name) => {
    const val = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(val)) return val[0]?.trim() || undefined;
    return typeof val === 'string' ? val.trim() || undefined : undefined;
  };
  return {
    requestId: get('x-request-id'),
    runId: get('x-run-id'),
    applierName: get('x-applier-name'),
    feature: get('x-feature'),
    jobId: get('x-job-id'),
  };
}

/**
 * Build raw usage object from normalized token counts (for pre-computed usage).
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
