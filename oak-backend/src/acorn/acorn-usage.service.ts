import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { compactError } from '../ai/openai/llm-log-fields';
import type { ChatUsage } from '../ai/openai/openai.types';
import { appLogger } from '../common/logger/app-logger';
import { summarizeUsage } from '../oak/ai/oak-pricing';
import {
  ACORN_AI_USAGE_COLLECTION,
  NANOS_PER_USD,
  OAK_CLIENT,
} from './acorn.constants';
import { currentAcornContext } from './request-context';
import { AcornDbService } from './acorn-db.service';

const OBJECT_ID_BYTES = 12;

export type AcornUsageInput = {
  accountId: string;
  /** Product feature the call served (`acorn_ai_usage.feature`). */
  feature: string;
  /** HTTP route that made the call, e.g. `/api/oak/qa`. */
  path?: string;
  requestedModel: string;
  billedModel?: string;
  usage?: ChatUsage | null;
  cachedTokens?: number;
  /** What the provider billed, when it says (OpenRouter does). Else priced from a table. */
  costUsd?: number | null;
  durationMs: number;
  success?: boolean;
  httpStatus?: number;
  error?: string;
};

/** One row per model call in Acorn's `acorn_ai_usage`, the shape `aiusage.Entry` writes. */
@Injectable()
export class AcornUsageService {
  private readonly log = appLogger(AcornUsageService.name);

  constructor(private readonly db: AcornDbService) {}

  /** Persist one call; never throws to callers. */
  async record(input: AcornUsageInput): Promise<void> {
    try {
      if (!input.accountId) return;
      const model = input.billedModel || input.requestedModel;
      const promptTokens = input.usage?.promptTokens ?? 0;
      const completionTokens = input.usage?.completionTokens ?? 0;
      const cachedTokens = input.cachedTokens ?? input.usage?.cachedTokens ?? 0;
      const totalTokens =
        input.usage?.totalTokens ?? promptTokens + completionTokens;
      const priced = summarizeUsage(
        {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          prompt_cache_hit_tokens: cachedTokens,
          ...(typeof input.costUsd === 'number' ? { cost: input.costUsd } : {}),
        },
        model,
      );
      const context = currentAcornContext();
      const success = input.success ?? true;
      const rows = await this.db.collection(ACORN_AI_USAGE_COLLECTION);
      await rows.insertOne({
        _id: randomBytes(OBJECT_ID_BYTES).toString('hex') as never,
        accountId: input.accountId,
        tabKey: context.tabKey,
        model,
        feature: input.feature,
        step: '',
        route: input.path ?? '',
        client: OAK_CLIENT,
        clientVersion: context.clientVersion,
        supportBy: '',
        status: success ? 'ok' : 'error',
        errorKind: '',
        error: input.error ?? '',
        httpStatus: input.httpStatus ?? 0,
        attempts: 1,
        finishReason: '',
        promptTokens,
        completionTokens,
        cachedTokens,
        cacheWriteTokens: 0,
        totalTokens,
        costNanos: Math.round((priced.costUsd ?? 0) * NANOS_PER_USD),
        priced: Boolean(priced.priced),
        durationMs: input.durationMs,
        createdAt: new Date(),
      });
    } catch (err) {
      this.log.warn({ err: compactError(err) }, 'Acorn usage record failed');
    }
  }

  /** What the models cost for one Chrome tab, from every client that tagged the tab. */
  async tabCost(
    accountId: string,
    tabKey: string,
  ): Promise<{ costNanos: number; calls: number }> {
    if (!accountId || !tabKey) return { costNanos: 0, calls: 0 };
    const rows = await this.db.collection(ACORN_AI_USAGE_COLLECTION);
    const [total] = await rows
      .aggregate<{ costNanos: number; calls: number }>([
        { $match: { accountId, tabKey } },
        {
          $group: {
            _id: null,
            costNanos: { $sum: '$costNanos' },
            calls: { $sum: 1 },
          },
        },
      ])
      .toArray();
    return { costNanos: total?.costNanos ?? 0, calls: total?.calls ?? 0 };
  }
}
