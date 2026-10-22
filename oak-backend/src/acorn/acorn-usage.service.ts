import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { compactError } from '../ai/openai/llm-log-fields';
import type { ChatUsage } from '../ai/openai/openai.types';
import { appLogger } from '../common/logger/app-logger';
import { summarizeUsage } from '../oak/ai/oak-pricing';
import { ACORN_AI_USAGE_COLLECTION } from './acorn.constants';
import { AcornDbService } from './acorn-db.service';

const NANOS_PER_USD = 1e9;
const OBJECT_ID_BYTES = 12;

/** Client name stamped on Oak's rows in `acorn_ai_usage`. */
const OAK_CLIENT = 'oak';

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
        },
        model,
      );
      const success = input.success ?? true;
      const rows = await this.db.collection(ACORN_AI_USAGE_COLLECTION);
      await rows.insertOne({
        _id: randomBytes(OBJECT_ID_BYTES).toString('hex') as never,
        accountId: input.accountId,
        tabKey: '',
        model,
        feature: input.feature,
        step: '',
        route: input.path ?? '',
        client: OAK_CLIENT,
        clientVersion: '',
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
}
