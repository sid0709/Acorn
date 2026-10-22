import { Injectable, Logger } from '@nestjs/common';
import type { ProfileLlmAuth } from '../../ai/auth/profile-llm-auth.service';
import { OpenAiChatService } from '../../ai/openai/openai-chat.service';
import { AcornUsageService } from '../../acorn/acorn-usage.service';
import {
  OAK_USAGE_FEATURES,
  oakIdentityMaxOutputTokens,
  oakIdentityTimeoutMs,
} from '../constants/oak.constants';
import { collectIdentityQuestions } from './applicant-identity';
import { parseApplicationAiIndexes } from './oak-identity-parse';
import {
  buildIdentityUserPrompt,
  IDENTITY_SYSTEM_PROMPT,
} from './oak-identity-prompt';
import { IDENTITY_CLASSIFY_FORMAT } from './oak-identity-schema';
import { summarizeUsage, type OakUsageSummary } from './oak-pricing';
import { OakResponsesService } from './oak-responses.service';

@Injectable()
export class OakIdentityService {
  private readonly logger = new Logger(OakIdentityService.name);

  constructor(
    private readonly responses: OakResponsesService,
    private readonly chat: OpenAiChatService,
    private readonly usage: AcornUsageService,
  ) {}

  async classifyApplicationAiIndexes(input: {
    plan: unknown;
    auth: ProfileLlmAuth;
    applierName: string;
    page?: unknown;
  }): Promise<Set<number>> {
    const fields = collectIdentityQuestions(input.plan);
    if (!fields.length) return new Set();

    const startedAt = new Date();
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), oakIdentityTimeoutMs());
    const userPrompt = buildIdentityUserPrompt(fields);

    try {
      const raw =
        input.auth.provider === 'openai'
          ? await this.responses.requestJsonSchema(
              { apiKey: input.auth.apiKey, model: input.auth.model },
              {
                systemPrompt: IDENTITY_SYSTEM_PROMPT,
                userPrompt,
                format: IDENTITY_CLASSIFY_FORMAT,
                maxOutputTokens: oakIdentityMaxOutputTokens(),
                clampReasoningToLow: true,
                signal: controller.signal,
              },
            )
          : await this.classifyViaChat(
              input.auth,
              userPrompt,
              controller.signal,
            );

      const indexes = parseApplicationAiIndexes(raw.text, fields);
      await this.recordUsage(input, startedAt, t0, raw, true);
      return indexes;
    } catch (error) {
      this.logger.warn(
        `Identity classify skipped for ${input.applierName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.recordUsage(input, startedAt, t0, null, false, error);
      return new Set();
    } finally {
      clearTimeout(timer);
    }
  }

  private async classifyViaChat(
    auth: ProfileLlmAuth,
    userPrompt: string,
    signal: AbortSignal,
  ) {
    const completion = await this.chat.chatCompletion({
      provider: auth.provider,
      apiKey: auth.apiKey,
      model: auth.model,
      messages: [
        { role: 'system', content: IDENTITY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      jsonMode: true,
      temperature: 0.1,
      timeoutMs: oakIdentityTimeoutMs(),
      retries: 0,
      signal,
    });
    return {
      text: completion.content || '',
      model: completion.model || auth.model,
      usage: summarizeUsage(
        {
          prompt_tokens: completion.usage?.promptTokens,
          completion_tokens: completion.usage?.completionTokens,
          total_tokens: completion.usage?.totalTokens,
          prompt_cache_hit_tokens: completion.usage?.cachedTokens,
          cost: completion.usage?.costUsd,
        },
        completion.model || auth.model,
      ),
    };
  }

  private recordUsage(
    input: { auth: ProfileLlmAuth; applierName: string; page?: unknown },
    startedAt: Date,
    t0: number,
    raw: { model: string; usage: OakUsageSummary } | null,
    success: boolean,
    error?: unknown,
  ) {
    return this.usage.record({
      feature: OAK_USAGE_FEATURES.identity,
      accountId: input.auth.profileId,
      path: '/api/oak/ai-analyze',
      requestedModel: input.auth.model,
      billedModel: raw?.model,
      usage: raw
        ? {
            promptTokens: raw.usage.inputTokens,
            completionTokens: raw.usage.outputTokens,
            totalTokens: raw.usage.totalTokens,
          }
        : undefined,
      cachedTokens: raw?.usage.cachedInputTokens,
      durationMs: Date.now() - t0,
      success,
      error: success
        ? undefined
        : error instanceof Error
          ? error.message
          : String(error),
    });
  }
}
