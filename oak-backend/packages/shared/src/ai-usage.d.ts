declare module '@nextoffer/shared/ai-usage' {
  export const LLM_CALL_LOG_COLLECTION: string;

  export type AiUsageService = 'ai-bff' | 'athens-server';
  export type AiUsageProvider = 'openai' | 'deepseek' | 'ollama';

  export interface CallLogRates {
    inputPer1M: number;
    cachedInputPer1M: number;
    outputPer1M: number;
  }

  export interface CallLogEntry {
    requestId: string;
    createdAt?: Date;
    runId?: string;
    applierName?: string;
    jobId?: string;
    service: AiUsageService;
    feature: string;
    path?: string;
    provider: AiUsageProvider;
    requestedModel: string;
    billedModel: string;
    modelMismatch: boolean;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    priced: boolean;
    rates: CallLogRates;
    durationMs: number;
    success: boolean;
    httpStatus?: number;
    error?: string;
  }

  export function normalizeRawUsage(rawUsage: Record<string, unknown>): {
    cacheMiss: number;
    cacheHit: number;
    outputTokens: number;
    totalTokens: number;
  };

  export function calculateBilledCost(
    billedModel: string,
    rawUsage: Record<string, unknown>,
  ): {
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    priced: boolean;
  };

  export function ratesForBilledModel(billedModel: string): CallLogRates;

  export function buildCallLogEntry(params: {
    requestId?: string;
    service: AiUsageService;
    feature: string;
    provider: AiUsageProvider;
    requestedModel: string;
    billedModel: string;
    rawUsage: Record<string, unknown>;
    durationMs: number;
    success?: boolean;
    httpStatus?: number;
    error?: string;
    runId?: string;
    applierName?: string;
    jobId?: string;
    path?: string;
  }): Omit<CallLogEntry, 'createdAt'>;

  export function ensureCallLogIndexes(collection: {
    createIndex: (...args: unknown[]) => Promise<unknown>;
  }): Promise<void>;

  export function createCallLogRecorder(
    collection:
      { insertOne: (document: unknown) => Promise<unknown> } | null | undefined,
  ): (entry: Omit<CallLogEntry, 'createdAt'>) => Promise<CallLogEntry | null>;

  export function parseCorrelationHeaders(req: {
    headers?: Record<string, string | string[] | undefined>;
  }): {
    requestId?: string;
    runId?: string;
    applierName?: string;
    feature?: string;
    jobId?: string;
  };

  export function tokensToRawUsage(tokens: {
    promptTokens?: number;
    cachedTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }): Record<string, unknown>;
}
