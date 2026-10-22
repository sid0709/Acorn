import { Injectable } from '@nestjs/common';
import { ProfileLlmAuthService } from '../../ai/auth/profile-llm-auth.service';
import { OpenAiChatService } from '../../ai/openai/openai-chat.service';
import { AI_USAGE_FEATURES } from '../../ai-usage/constants/ai-usage.constants';
import { AiUsageRecorderService } from '../../ai-usage/ai-usage-recorder.service';
import { appLogger } from '../../common/logger/app-logger';
import {
  oakProseMaxOutputTokens,
  oakProseTemperature,
  oakProseTimeoutMs,
} from '../constants/oak.constants';
import { jobIdFromPage } from '../policy/analyze-page';
import { parseProseAnswerMap } from './oak-prose-fields';
import {
  buildQaUserPrompt,
  PROSE_SYSTEM_PROMPT,
  QA_FIELD_INDEX,
} from './oak-prose-prompt';
import { summarizeUsage } from './oak-pricing';
import { OakProfilePromptService } from './oak-profile-prompt.service';
import { PROSE_ANSWERS_FORMAT } from './oak-prose-schema';
import { OakResponsesService } from './oak-responses.service';

@Injectable()
export class OakQaService {
  private readonly log = appLogger(OakQaService.name);

  constructor(
    private readonly llmAuth: ProfileLlmAuthService,
    private readonly profilePrompt: OakProfilePromptService,
    private readonly responses: OakResponsesService,
    private readonly chat: OpenAiChatService,
    private readonly usage: AiUsageRecorderService,
  ) {}

  async answer(input: {
    profileId: string;
    applierName: string;
    question: string;
    page?: unknown;
  }) {
    const question = String(input.question || '').trim();
    const auth = await this.llmAuth.resolve({
      profileId: input.profileId,
      applierName: input.applierName,
    });
    const applicantProfile = await this.profilePrompt.buildApplicantProfileText(
      input.profileId,
    );
    const userPrompt = buildQaUserPrompt({
      applicantProfile,
      question,
      page: input.page,
    });

    const startedAt = new Date();
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), oakProseTimeoutMs());

    try {
      const raw =
        auth.provider === 'openai'
          ? await this.responses.requestJsonSchema(
              { apiKey: auth.apiKey, model: auth.model },
              {
                systemPrompt: PROSE_SYSTEM_PROMPT,
                userPrompt,
                format: PROSE_ANSWERS_FORMAT,
                maxOutputTokens: oakProseMaxOutputTokens(),
                temperature: oakProseTemperature(),
                signal: controller.signal,
              },
            )
          : await this.writeViaChat(auth, userPrompt, controller.signal);

      const parsed = parseProseAnswerMap(raw.text, new Set([QA_FIELD_INDEX]));
      const answer = parsed.get(QA_FIELD_INDEX)?.trim() || '';
      if (!answer) {
        throw new Error('Writer returned no answer');
      }

      await this.usage.record({
        feature: AI_USAGE_FEATURES.oakAiQa,
        applierName: input.applierName,
        jobId: jobIdFromPage(input.page) ?? undefined,
        path: '/api/oak/qa',
        provider: auth.provider,
        requestedModel: auth.model,
        billedModel: raw.model,
        apiKey: auth.apiKey,
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

      return {
        ok: true as const,
        answer,
        model: raw.model,
        usage: raw.usage,
      };
    } catch (error) {
      this.log.warn(
        {
          applierName: input.applierName,
          err: error instanceof Error ? error.message : String(error),
        },
        'oak qa failed',
      );
      await this.usage.record({
        feature: AI_USAGE_FEATURES.oakAiQa,
        applierName: input.applierName,
        jobId: jobIdFromPage(input.page) ?? undefined,
        path: '/api/oak/qa',
        provider: auth.provider,
        requestedModel: auth.model,
        apiKey: auth.apiKey,
        startedAt,
        durationMs: Date.now() - t0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async writeViaChat(
    auth: Awaited<ReturnType<ProfileLlmAuthService['resolve']>>,
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
