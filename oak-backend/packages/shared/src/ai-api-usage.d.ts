declare module '@nextoffer/shared/ai-api-usage' {
  export const AI_API_USAGE_COLLECTION: string;

  export function ratesForBilledModel(billedModel: string): {
    inputPer1M: number;
    cachedInputPer1M: number;
    outputPer1M: number;
  };

  export function buildAiApiUsageEntry(params: {
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
  }): Record<string, unknown>;

  export function ensureAiApiUsageIndexes(collection: unknown): Promise<void>;

  export function createAiApiUsageRecorder(
    collection: unknown,
  ): (
    entry: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;

  export function tokensToRawUsage(params: {
    promptTokens?: number;
    cachedTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }): Record<string, unknown>;
}
