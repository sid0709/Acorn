import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { compactError } from '../ai/openai/llm-log-fields';
import type { ChatUsage } from '../ai/openai/openai.types';
import { appLogger } from '../common/logger/app-logger';
import {
  rawInsertOne,
  withReplicaSetFallback,
} from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';
import {
  AI_USAGE_COLLECTION,
  AI_USAGE_SERVICE,
} from './constants/ai-usage.constants';
import { buildAiApiUsageEntry, tokensToRawUsage } from './lib/ai-api-usage';

export type AiUsageRecordMeta = {
  feature: string;
  applierName?: string;
  runId?: string;
  jobId?: string;
  path?: string;
  requestId?: string;
};

export type AiUsageRecordInput = AiUsageRecordMeta & {
  provider: string;
  requestedModel: string;
  billedModel?: string;
  apiKey?: string;
  usage?: ChatUsage | null;
  cachedTokens?: number;
  startedAt?: Date;
  durationMs: number;
  success?: boolean;
  httpStatus?: number;
  error?: string;
};

@Injectable()
export class AiUsageRecorderService {
  private readonly log = appLogger(AiUsageRecorderService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Persist one completion; never throws to callers. */
  async record(input: AiUsageRecordInput): Promise<void> {
    try {
      const entry = buildAiApiUsageEntry({
        requestId: input.requestId,
        feature: input.feature,
        provider: input.provider,
        requestedModel: input.requestedModel,
        billedModel: input.billedModel || input.requestedModel,
        apiKey: input.apiKey,
        rawUsage: tokensToRawUsage({
          promptTokens: input.usage?.promptTokens ?? 0,
          cachedTokens: input.cachedTokens ?? input.usage?.cachedTokens ?? 0,
          completionTokens: input.usage?.completionTokens ?? 0,
          totalTokens: input.usage?.totalTokens,
        }),
        startedAt: input.startedAt,
        durationMs: input.durationMs,
        success: input.success ?? true,
        httpStatus: input.httpStatus,
        error: input.error,
        runId: input.runId,
        applierName: input.applierName,
        jobId: input.jobId,
        path: input.path,
      });

      const data = toPrismaCreate(entry);
      await withReplicaSetFallback(
        () => this.prisma.aiApiUsage.create({ data }),
        async () => {
          await rawInsertOne(this.prisma, AI_USAGE_COLLECTION, {
            ...data,
            createdAt: new Date(),
            service: AI_USAGE_SERVICE,
          });
          return null;
        },
      );
      this.log.info(
        {
          requestId: data.requestId,
          feature: data.feature,
          path: data.path,
          provider: data.provider,
          requestedModel: data.requestedModel,
          billedModel: data.billedModel,
          modelMismatch: data.modelMismatch,
          success: data.success,
          httpStatus: data.httpStatus,
          durationMs: data.durationMs,
          inputTokens: data.inputTokens,
          cachedInputTokens: data.cachedInputTokens,
          outputTokens: data.outputTokens,
          totalTokens: data.totalTokens,
          costUsd: data.costUsd,
          priced: data.priced,
          runId: data.runId,
          jobId: data.jobId,
          applierName: data.applierName,
        },
        'ai_api_usage persisted',
      );
    } catch (err) {
      this.log.warn(
        {
          feature: input.feature,
          path: input.path,
          provider: input.provider,
          requestedModel: input.requestedModel,
          success: input.success,
          durationMs: input.durationMs,
          err: compactError(err),
        },
        'ai_api_usage write failed',
      );
    }
  }
}

function toPrismaCreate(
  entry: Record<string, unknown>,
): Prisma.AiApiUsageCreateInput {
  const rates = entry.rates;
  return {
    requestId: String(entry.requestId),
    feature: asOptStr(entry.feature),
    provider: asOptStr(entry.provider),
    requestedModel: asOptStr(entry.requestedModel),
    billedModel: asOptStr(entry.billedModel),
    modelMismatch:
      typeof entry.modelMismatch === 'boolean'
        ? entry.modelMismatch
        : undefined,
    apiKey: asOptStr(entry.apiKey) ?? '',
    inputTokens: asOptInt(entry.inputTokens),
    cachedInputTokens: asOptInt(entry.cachedInputTokens),
    outputTokens: asOptInt(entry.outputTokens),
    totalTokens: asOptInt(entry.totalTokens),
    costUsd: typeof entry.costUsd === 'number' ? entry.costUsd : undefined,
    priced: typeof entry.priced === 'boolean' ? entry.priced : undefined,
    rates: rates && typeof rates === 'object' ? rates : undefined,
    startedAt: entry.startedAt instanceof Date ? entry.startedAt : undefined,
    durationMs: asOptInt(entry.durationMs),
    success: typeof entry.success === 'boolean' ? entry.success : true,
    httpStatus: asOptInt(entry.httpStatus),
    error: asOptStr(entry.error),
    runId: asOptStr(entry.runId),
    applierName: asOptStr(entry.applierName),
    jobId: asOptStr(entry.jobId),
    path: asOptStr(entry.path),
    service: AI_USAGE_SERVICE,
  };
}

function asOptStr(value: unknown): string | undefined {
  const s = String(value ?? '').trim();
  return s || undefined;
}

function asOptInt(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}
