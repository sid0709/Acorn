import { Injectable } from '@nestjs/common';
import { compactError, llmMessageStats } from '../ai/openai/llm-log-fields';
import { OpenAiChatService } from '../ai/openai/openai-chat.service';
import type {
  ChatCompletionInput,
  ChatCompletionResult,
} from '../ai/openai/openai.types';
import { appLogger } from '../common/logger/app-logger';
import {
  AiUsageRecorderService,
  type AiUsageRecordMeta,
} from './ai-usage-recorder.service';

export type ChatWithUsageInput = ChatCompletionInput & {
  usageMeta?: AiUsageRecordMeta;
};

/**
 * Thin wrapper: OpenAI chat + optional ai_api_usage persist when usageMeta set.
 */
@Injectable()
export class AiChatWithUsageService {
  private readonly log = appLogger(AiChatWithUsageService.name);

  constructor(
    private readonly chat: OpenAiChatService,
    private readonly recorder: AiUsageRecorderService,
  ) {}

  async chatCompletion(
    input: ChatWithUsageInput,
  ): Promise<ChatCompletionResult> {
    const startedAt = new Date();
    const t0 = Date.now();
    const meta = input.usageMeta;
    const stats = llmMessageStats(input.messages);
    const base = {
      provider: input.provider ?? 'openai',
      model: input.model,
      persistUsage: Boolean(meta),
      feature: meta?.feature,
      path: meta?.path,
      applierName: meta?.applierName,
      runId: meta?.runId,
      jobId: meta?.jobId,
      requestId: meta?.requestId,
      ...stats,
    };

    this.log.debug(base, 'AI API start');

    try {
      const result = await this.chat.chatCompletion(input);
      const durationMs = Date.now() - t0;
      this.log.debug(
        {
          ...base,
          billedModel: result.model || input.model,
          durationMs,
          promptTokens: result.usage?.promptTokens,
          completionTokens: result.usage?.completionTokens,
          totalTokens: result.usage?.totalTokens,
        },
        'AI API ok',
      );
      if (meta) {
        await this.recorder.record({
          ...meta,
          provider: input.provider ?? 'openai',
          requestedModel: input.model,
          billedModel: result.model || input.model,
          apiKey: input.apiKey,
          usage: result.usage,
          startedAt,
          durationMs,
          success: true,
        });
      }
      return result;
    } catch (err) {
      const durationMs = Date.now() - t0;
      const status = (err as { status?: number })?.status;
      const aborted =
        Boolean(input.signal?.aborted) ||
        (err instanceof Error && err.name === 'AbortError');
      const failFields = {
        ...base,
        durationMs,
        httpStatus: typeof status === 'number' ? status : undefined,
        errName: err instanceof Error ? err.name : typeof err,
        err: compactError(err),
      };
      if (aborted) this.log.warn(failFields, 'AI API aborted');
      else this.log.error(failFields, 'AI API failed');
      if (meta) {
        const message = err instanceof Error ? err.message : String(err);
        await this.recorder.record({
          ...meta,
          provider: input.provider ?? 'openai',
          requestedModel: input.model,
          billedModel: input.model,
          apiKey: input.apiKey,
          usage: null,
          startedAt,
          durationMs,
          success: false,
          httpStatus: typeof status === 'number' ? status : undefined,
          error: message,
        });
      }
      throw err;
    }
  }
}
