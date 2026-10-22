import { Injectable } from '@nestjs/common';
import { ProfileLlmAuthService } from '../../ai/auth/profile-llm-auth.service';
import { OpenAiChatService } from '../../ai/openai/openai-chat.service';
import { AcornUsageService } from '../../acorn/acorn-usage.service';
import { appLogger } from '../../common/logger/app-logger';
import {
  OAK_USAGE_FEATURES,
  oakPlannerReasoningEffort,
} from '../constants/oak.constants';
import { OakFillPolicyService } from '../policy/oak-fill-policy.service';
import {
  applyApplicantIdentityToPlan,
  keepPlannerAnswers,
} from './applicant-identity';
import { OakIdentityService } from './oak-identity.service';
import { buildAnalyzePrompt } from './oak-prompt';
import { OakProfilePromptService } from './oak-profile-prompt.service';
import { OakProseService } from './oak-prose.service';
import { OakResponsesService } from './oak-responses.service';
import { summarizeUsage } from './oak-pricing';
import { validatePlanShape } from './oak-schema';

@Injectable()
export class OakAnalyzeService {
  private readonly log = appLogger(OakAnalyzeService.name);

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
    const prepStarted = Date.now();
    // Three independent reads: the Library flag, the model key, and the profile.
    const [policy, auth, applicantProfile] = await Promise.all([
      this.fillPolicy.resolveForAnalyze({
        accountId: input.profileId,
        page: input.page,
      }),
      this.llmAuth.resolve({
        profileId: input.profileId,
        applierName: input.applierName,
      }),
      this.profilePrompt.buildApplicantProfileText(input.profileId),
    ]);
    const prepMs = Date.now() - prepStarted;
    const { systemPrompt, userPrompt } = buildAnalyzePrompt({
      applicantProfile,
      pureTree: input.pureTree,
      page: policy.page,
    });
    const t0 = Date.now();
    try {
      const result =
        auth.provider === 'openai'
          ? await this.responses.requestActionPlan(
              { apiKey: auth.apiKey, model: auth.model },
              systemPrompt,
              userPrompt,
              oakPlannerReasoningEffort(),
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
        costUsd: result.usage.costUsd,
        durationMs: Date.now() - t0,
        success: true,
      });

      const plannerMs = Date.now() - t0;
      const followStarted = Date.now();
      // The identity check and the typed-answer rewrite do not depend on each other: they run at
      // once. The rewrite works on a copy, and an identity question keeps the planner's own answer
      // (then forced to no), never a rewritten one.
      const [applicationAiIndexes, rewritten] = await Promise.all([
        this.identity.classifyApplicationAiIndexes({
          plan: result.plan,
          auth,
          applierName: input.applierName,
          page: policy.page,
        }),
        this.prose.rewriteTypingFills({
          plan: structuredClone(result.plan),
          auth,
          applicantProfile,
          applierName: input.applierName,
          page: policy.page,
        }),
      ]);
      const plan = applyApplicantIdentityToPlan(
        keepPlannerAnswers(rewritten, result.plan, applicationAiIndexes),
        applicationAiIndexes,
      );
      this.log.info(
        {
          accountId: input.profileId,
          provider: auth.provider,
          model: result.model,
          prepMs,
          plannerMs,
          followUpMs: Date.now() - followStarted,
          totalMs: Date.now() - prepStarted,
          inputTokens: result.usage.inputTokens,
          cachedInputTokens: result.usage.cachedInputTokens,
          outputTokens: result.usage.outputTokens,
        },
        'oak analyze timing',
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
      reasoningEffort: oakPlannerReasoningEffort(),
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
          cost: completion.usage?.costUsd,
        },
        model,
      ),
    };
  }
}
