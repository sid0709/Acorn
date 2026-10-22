import { Injectable, Logger } from '@nestjs/common';
import type { ProfileLlmAuth } from '../../ai/auth/profile-llm-auth.service';
import { OpenAiChatService } from '../../ai/openai/openai-chat.service';
import { AI_USAGE_FEATURES } from '../../ai-usage/constants/ai-usage.constants';
import { AiUsageRecorderService } from '../../ai-usage/ai-usage-recorder.service';
import {
  oakProseMaxOutputTokens,
  oakProseTemperature,
  oakProseTimeoutMs,
} from '../constants/oak.constants';
import { jobIdFromPage } from '../policy/analyze-page';
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
    private readonly usage: AiUsageRecorderService,
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

    const startedAt = new Date();
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
        feature: AI_USAGE_FEATURES.oakAiProse,
        applierName: input.applierName,
        jobId: jobIdFromPage(input.page) ?? undefined,
        path: '/api/oak/ai-analyze',
        provider: input.auth.provider,
        requestedModel: input.auth.model,
        billedModel: raw.model,
        apiKey: input.auth.apiKey,
        usage: {
          promptTokens: raw.usage.inputTokens,
          completionTokens: raw.usage.outputTokens,
          totalTokens: raw.usage.totalTokens,
        },
        cachedTokens: raw.usage.cachedInputTokens,
        startedAt,
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
        feature: AI_USAGE_FEATURES.oakAiProse,
        applierName: input.applierName,
        jobId: jobIdFromPage(input.page) ?? undefined,
        path: '/api/oak/ai-analyze',
        provider: input.auth.provider,
        requestedModel: input.auth.model,
        apiKey: input.auth.apiKey,
        startedAt,
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
        },
        completion.model || auth.model,
      ),
    };
  }
}
