import { Injectable } from '@nestjs/common';
import { ProfileLlmAuthService } from '../../ai/auth/profile-llm-auth.service';
import { OpenAiChatService } from '../../ai/openai/openai-chat.service';
import { AcornUsageService } from '../../acorn/acorn-usage.service';
import { OAK_USAGE_FEATURES } from '../constants/oak.constants';
import { OakFillPolicyService } from '../policy/oak-fill-policy.service';
import { applyApplicantIdentityToPlan } from './applicant-identity';
import { OakIdentityService } from './oak-identity.service';
import { buildAnalyzePrompt } from './oak-prompt';
import { OakProfilePromptService } from './oak-profile-prompt.service';
import { OakProseService } from './oak-prose.service';
import { OakResponsesService } from './oak-responses.service';
import { summarizeUsage } from './oak-pricing';
import { validatePlanShape } from './oak-schema';

@Injectable()
export class OakAnalyzeService {
  constructor(
    private readonly llmAuth: ProfileLlmAuthService,
    private readonly profilePrompt: OakProfilePromptService,
    private readonly responses: OakResponsesService,
    private readonly chat: OpenAiChatService,
    private readonly usage: AcornUsageService,
    private readonly fillPolicy: OakFillPolicyService,
    private readonly prose: OakProseService,
    private readonly identity: OakIdentityService,
  ) {}

  async analyze(input: {
    profileId: string;
    applierName: string;
    pureTree: string;
    /** Accepted from older extensions for wire compatibility; not sent to the model. */
    metaTree?: string;
    page?: unknown;
  }) {
    const policy = await this.fillPolicy.resolveForAnalyze({
      accountId: input.profileId,
      page: input.page,
    });
    const auth = await this.llmAuth.resolve({
      profileId: input.profileId,
      applierName: input.applierName,
    });
    const applicantProfile = await this.profilePrompt.buildApplicantProfileText(
      input.profileId,
    );
    const { systemPrompt, userPrompt } = buildAnalyzePrompt({
      applicantProfile,
      pureTree: input.pureTree,
      page: policy.page,
    });

    const startedAt = new Date();
    const t0 = Date.now();
    try {
      const result =
        auth.provider === 'openai'
          ? await this.responses.requestActionPlan(
              { apiKey: auth.apiKey, model: auth.model },
              systemPrompt,
              userPrompt,
            )
          : await this.analyzeViaChat(auth, systemPrompt, userPrompt);

      await this.usage.record({
        feature: OAK_USAGE_FEATURES.analyze,
        accountId: input.profileId,
        path: '/api/oak/ai-analyze',
        requestedModel: auth.model,
        billedModel: result.model,
        usage: {
          promptTokens: result.usage.inputTokens,
          completionTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
        },
        cachedTokens: result.usage.cachedInputTokens,
        durationMs: Date.now() - t0,
        success: true,
      });

      const applicationAiIndexes =
        await this.identity.classifyApplicationAiIndexes({
          plan: result.plan,
          auth,
          applierName: input.applierName,
          page: policy.page,
        });
      const drafted = applyApplicantIdentityToPlan(
        result.plan,
        applicationAiIndexes,
      );
      const rewritten = await this.prose.rewriteTypingFills({
        plan: drafted,
        auth,
        applicantProfile,
        applierName: input.applierName,
        page: policy.page,
      });
      const plan = applyApplicantIdentityToPlan(
        rewritten,
        applicationAiIndexes,
      );
      return {
        ok: true as const,
        plan,
        model: result.model,
        responseId: result.responseId ?? null,
        usage: result.usage,
      };
    } catch (error) {
      await this.usage.record({
        feature: OAK_USAGE_FEATURES.analyze,
        accountId: input.profileId,
        path: '/api/oak/ai-analyze',
        requestedModel: auth.model,
        durationMs: Date.now() - t0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async analyzeViaChat(
    auth: Awaited<ReturnType<ProfileLlmAuthService['resolve']>>,
    systemPrompt: string,
    userPrompt: string,
  ) {
    const completion = await this.chat.chatCompletion({
      provider: auth.provider,
      apiKey: auth.apiKey,
      model: auth.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      jsonMode: true,
      temperature: 0.1,
    });

    let plan: unknown;
    try {
      plan = JSON.parse(completion.content || '');
    } catch {
      throw new Error('LLM returned non-JSON output');
    }
    validatePlanShape(plan);

    const model = completion.model || auth.model;
    return {
      plan: plan,
      model,
      responseId: null as string | null,
      usage: summarizeUsage(
        {
          prompt_tokens: completion.usage?.promptTokens,
          completion_tokens: completion.usage?.completionTokens,
          total_tokens: completion.usage?.totalTokens,
          prompt_cache_hit_tokens: completion.usage?.cachedTokens,
        },
        model,
      ),
    };
  }
}

function gapKind(label: string): string | null {
  if (/\b(resume|cv|curriculum)\b/i.test(label)) return 'resume';
  if (/hear about|how did you hear/i.test(label)) return 'hear';
  if (/\b(sponsor|visa|h-?1b)\b/i.test(label)) return 'visa';
  if (/electronic signature|\bsignature\b/i.test(label)) return 'signature';
  if (/street address|address line|what is your street/i.test(label)) {
    return 'address';
  }
  return null;
}
