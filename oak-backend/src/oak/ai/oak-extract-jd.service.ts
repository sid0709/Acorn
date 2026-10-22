import { BadRequestException, Injectable } from '@nestjs/common';
import { ProfileLlmAuthService } from '../../ai/auth/profile-llm-auth.service';
import { OpenAiChatService } from '../../ai/openai/openai-chat.service';
import { AI_USAGE_FEATURES } from '../../ai-usage/constants/ai-usage.constants';
import { AiUsageRecorderService } from '../../ai-usage/ai-usage-recorder.service';
import { appLogger } from '../../common/logger/app-logger';
import { cleanString } from '../../resumes/generator/lib/clean-string';
import {
  oakExtractJdMaxOutputTokens,
  oakExtractJdTimeoutMs,
  oakTemperature,
} from '../constants/oak.constants';
import { metaToPageText } from '../policy/meta-to-page-text';
import {
  buildExtractJdUserPrompt,
  EXTRACT_JD_SYSTEM_PROMPT,
} from './oak-extract-jd-prompt';
import {
  EXTRACT_JD_FORMAT,
  EXTRACT_JD_JSON_SCHEMA,
  EXTRACT_JD_SCHEMA_NAME,
  parseExtractJdResponse,
} from './oak-extract-jd-schema';
import { summarizeUsage } from './oak-pricing';
import { OakResponsesService } from './oak-responses.service';

const EXTRACT_JD_PATH = '/api/oak/custom/extract-jd';

@Injectable()
export class OakExtractJdService {
  private readonly log = appLogger(OakExtractJdService.name);

  constructor(
    private readonly llmAuth: ProfileLlmAuthService,
    private readonly responses: OakResponsesService,
    private readonly chat: OpenAiChatService,
    private readonly usage: AiUsageRecorderService,
  ) {}

  async extract(input: {
    profileId: string;
    applierName: string;
    pageText?: unknown;
    meta?: unknown;
  }) {
    const pageText = cleanString(input.pageText) || metaToPageText(input.meta);
    if (!pageText) {
      throw new BadRequestException({
        success: false,
        error: 'pageText or meta is required',
      });
    }

    const auth = await this.llmAuth.resolve({
      profileId: input.profileId,
      applierName: input.applierName,
    });
    const userPrompt = buildExtractJdUserPrompt(pageText);
    const startedAt = new Date();
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), oakExtractJdTimeoutMs());

    try {
      const raw =
        auth.provider === 'openai'
          ? await this.responses.requestJsonSchema(
              { apiKey: auth.apiKey, model: auth.model },
              {
                systemPrompt: EXTRACT_JD_SYSTEM_PROMPT,
                userPrompt,
                format: EXTRACT_JD_FORMAT,
                maxOutputTokens: oakExtractJdMaxOutputTokens(),
                clampReasoningToLow: true,
                temperature: oakTemperature(),
                signal: controller.signal,
              },
            )
          : await this.extractViaChat(auth, userPrompt, controller.signal);

      const parsed = parseExtractJdResponse(raw.text);

      await this.usage.record({
        feature: AI_USAGE_FEATURES.oakExtractJd,
        applierName: input.applierName,
        path: EXTRACT_JD_PATH,
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

      this.log.info(
        {
          applierName: input.applierName,
          hasJobDescription: parsed.hasJobDescription,
          provider: auth.provider,
          model: raw.model,
          durationMs: Date.now() - t0,
        },
        'oak extract-jd ok',
      );

      return {
        ok: true as const,
        hasJobDescription: parsed.hasJobDescription,
        jobDescription: parsed.jobDescription,
        reason: parsed.reason,
        model: raw.model,
        usage: raw.usage,
      };
    } catch (error) {
      this.log.warn(
        {
          applierName: input.applierName,
          err: error instanceof Error ? error.message : String(error),
        },
        'oak extract-jd failed',
      );
      await this.usage.record({
        feature: AI_USAGE_FEATURES.oakExtractJd,
        applierName: input.applierName,
        path: EXTRACT_JD_PATH,
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

  private async extractViaChat(
    auth: Awaited<ReturnType<ProfileLlmAuthService['resolve']>>,
    userPrompt: string,
    signal: AbortSignal,
  ) {
    const completion = await this.chat.chatCompletion({
      provider: auth.provider,
      apiKey: auth.apiKey,
      model: auth.model,
      messages: [
        { role: 'system', content: EXTRACT_JD_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      jsonMode: true,
      jsonSchema: {
        name: EXTRACT_JD_SCHEMA_NAME,
        schema: EXTRACT_JD_JSON_SCHEMA,
        strict: true,
      },
      temperature: oakTemperature(),
      timeoutMs: oakExtractJdTimeoutMs(),
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
