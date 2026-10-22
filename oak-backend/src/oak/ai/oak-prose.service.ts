import { Injectable, Logger } from '@nestjs/common';
import type { ProfileLlmAuth } from '../../ai/auth/profile-llm-auth.service';
import { OpenAiChatService } from '../../ai/openai/openai-chat.service';
import { AcornUsageService } from '../../acorn/acorn-usage.service';
import {
  OAK_USAGE_FEATURES,
  oakProseMaxOutputTokens,
  oakProseTemperature,
  oakProseTimeoutMs,
  oakHelperReasoningEffort,
  OAK_PROMPT_CACHE_KEYS,
} from '../constants/oak.constants';
import {
  overlayTypingFillValues,
  parseProseAnswerMap,
  selectTypingFillActions,
} from './oak-prose-fields';
import { buildProseUserPrompt, PROSE_SYSTEM_PROMPT } from './oak-prose-prompt';
import { summarizeUsage } from './oak-pricing';
import { PROSE_ANSWERS_FORMAT } from './oak-prose-schema';
import { OakResponsesService } from './oak-responses.service';

@Injectable()
export class OakProseService {
  private readonly logger = new Logger(OakProseService.name);

  constructor(
    private readonly responses: OakResponsesService,
    private readonly chat: OpenAiChatService,
    private readonly usage: AcornUsageService,
  ) {}

  async rewriteTypingFills(input: {
    plan: unknown;
    auth: ProfileLlmAuth;
    applicantProfile: string;
    applierName: string;
    page?: unknown;
  }): Promise<unknown> {
    const fields = selectTypingFillActions(input.plan);
    if (!fields.length) return input.plan;
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), oakProseTimeoutMs());
    const userPrompt = buildProseUserPrompt({
      applicantProfile: input.applicantProfile,
      fields,
      page: input.page,
    });

    try {
      const raw =
        input.auth.provider === 'openai'
          ? await this.responses.requestJsonSchema(
              { apiKey: input.auth.apiKey, model: input.auth.model },
              {
                systemPrompt: PROSE_SYSTEM_PROMPT,
                userPrompt,
                format: PROSE_ANSWERS_FORMAT,
                reasoningEffort: oakHelperReasoningEffort(),
                cacheKey: OAK_PROMPT_CACHE_KEYS.prose,
                maxOutputTokens: oakProseMaxOutputTokens(),
                temperature: oakProseTemperature(),
                signal: controller.signal,
              },
            )
          : await this.writeViaChat(input.auth, userPrompt, controller.signal);

      const allowed = new Set(fields.map((field) => field.elementIndex));
      const parsed = parseProseAnswerMap(raw.text, allowed);
      const next = overlayTypingFillValues(input.plan, parsed);
      await this.usage.record({
        feature: OAK_USAGE_FEATURES.prose,
        accountId: input.auth.profileId,
        path: '/api/oak/ai-analyze',
        requestedModel: input.auth.model,
        billedModel: raw.model,
        usage: {
          promptTokens: raw.usage.inputTokens,
          completionTokens: raw.usage.outputTokens,
          totalTokens: raw.usage.totalTokens,
        },
        cachedTokens: raw.usage.cachedInputTokens,
        costUsd: raw.usage.costUsd,
        durationMs: Date.now() - t0,
        success: true,
      });
      return next;
    } catch (error) {
      this.logger.warn(
        `Typing-field rewrite skipped for ${input.applierName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.usage.record({
        feature: OAK_USAGE_FEATURES.prose,
        accountId: input.auth.profileId,
        path: '/api/oak/ai-analyze',
        requestedModel: input.auth.model,
        durationMs: Date.now() - t0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return input.plan;
    } finally {
      clearTimeout(timer);
    }
  }

  private async writeViaChat(
    auth: ProfileLlmAuth,
    userPrompt: string,
    signal: AbortSignal,
  ) {
    const completion = await this.chat.chatCompletion({
      provider: auth.provider,
      apiKey: auth.apiKey,
      model: auth.model,
      messages: [
        { role: 'system', content: PROSE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      jsonMode: true,
      reasoningEffort: oakHelperReasoningEffort(),
      temperature: oakProseTemperature(),
      timeoutMs: oakProseTimeoutMs(),
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
}
