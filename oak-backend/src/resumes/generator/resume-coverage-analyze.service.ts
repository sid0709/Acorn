import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ProfileLlmAuthService } from '../../ai/auth/profile-llm-auth.service';
import { AiChatWithUsageService } from '../../ai-usage/ai-chat-with-usage.service';
import { AI_USAGE_FEATURES } from '../../ai-usage/constants/ai-usage.constants';
import { cleanString } from './lib/clean-string';
import { parseResumeCoverageAnalysis } from './lib/coverage-parse';
import { usageWithCost } from './lib/usage-aggregate';
import { RESUME_COVERAGE_ANALYSIS_PROMPT } from './prompts/coverage-analyze.prompt';

@Injectable()
export class ResumeCoverageAnalyzeService {
  constructor(
    private readonly llmAuth: ProfileLlmAuthService,
    private readonly chat: AiChatWithUsageService,
  ) {}

  async analyze(input: {
    applierName: string;
    jobDescription: string;
    profileId?: string;
    identity?: Record<string, unknown>;
    coverage?: {
      aliases?: Record<string, string[]>;
      experienceRequirementThreshold?: number;
    };
  }) {
    const applierName = cleanString(input.applierName);
    const jobDescription = cleanString(input.jobDescription);
    if (!applierName) {
      throw new BadRequestException({
        success: false,
        error: 'applierName is required',
      });
    }
    if (!jobDescription) {
      throw new BadRequestException({
        success: false,
        error: 'jobDescription is required',
      });
    }

    const auth = await this.llmAuth.resolve({
      applierName,
      profileId: input.profileId,
    });

    const identity =
      input.identity && typeof input.identity === 'object'
        ? input.identity
        : {};

    const result = await this.chat.chatCompletion({
      provider: auth.provider,
      apiKey: auth.apiKey,
      model: auth.model,
      jsonMode: true,
      messages: [
        { role: 'system', content: RESUME_COVERAGE_ANALYSIS_PROMPT },
        {
          role: 'user',
          content: [
            `JOB DESCRIPTION:\n${jobDescription.slice(0, 20_000)}`,
            `CAREER HISTORY:\n${JSON.stringify(
              Array.isArray(identity.careers) ? identity.careers : [],
              null,
              2,
            ).slice(0, 20_000)}`,
          ].join('\n\n'),
        },
      ],
      usageMeta: {
        feature: AI_USAGE_FEATURES.resumeCoverageAnalyze,
        applierName: auth.applierName,
        path: '/personal/resume-generator/analyze',
      },
    });

    const analysis = parseResumeCoverageAnalysis(result.content, {
      jobDescription,
      identity,
      aliases: input.coverage?.aliases,
      experienceRequirementThreshold:
        input.coverage?.experienceRequirementThreshold,
    });

    if (!analysis.skills.length) {
      throw new UnprocessableEntityException({
        success: false,
        error:
          'No explicit technical skills could be extracted from this job description.',
      });
    }

    return {
      success: true as const,
      provider: auth.provider,
      model: auth.model,
      analysis,
      usage: usageWithCost(result.usage, result.model || auth.model),
    };
  }
}
