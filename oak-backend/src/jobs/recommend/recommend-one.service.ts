import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ProfileLlmAuthService } from '../../ai/auth/profile-llm-auth.service';
import {
  RECOMMEND_RESUME_JSON_SCHEMA,
  RECOMMEND_RESUME_SCHEMA_NAME,
  RECOMMEND_RESUME_SYSTEM_PROMPT,
  parseRecommendResumeResponse,
} from '../../ai/prompts';
import { AiChatWithUsageService } from '../../ai-usage/ai-chat-with-usage.service';
import { AI_USAGE_FEATURES } from '../../ai-usage/constants/ai-usage.constants';
import { resolveCatalogKey } from '../../bids/lib/resume-catalog';
import { PrismaService } from '../../prisma/prisma.service';
import {
  heuristicRecommend,
  type RecommendOneOutcome,
} from './recommend-resumes.helpers';

export type RecommendFromTextInput = {
  applierName: string;
  pageText: string;
  catalog: { text: string; stackNames: string[] };
  title?: string;
  url?: string;
  usagePath: string;
  jobId?: string;
};

@Injectable()
export class RecommendOneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmAuth: ProfileLlmAuthService,
    private readonly chat: AiChatWithUsageService,
  ) {}

  async recommend(
    applierName: string,
    jobId: string,
    catalog: { text: string; stackNames: string[] },
  ): Promise<RecommendOneOutcome> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, description: true, title: true },
    });
    if (!job) throw new Error('Job not found');

    return this.fromPageText({
      applierName,
      pageText: String(job.description || '')
        .replace(/\s+/g, ' ')
        .trim(),
      catalog,
      title: job.title || '(unknown)',
      url: '(job)',
      usagePath: '/jobs/recommend-resumes',
      jobId: String(job.id || ''),
    });
  }

  /** Match analyzed Library stacks to posting prose. Used by Job Search and Oak Custom. */
  async fromPageText(
    input: RecommendFromTextInput,
  ): Promise<RecommendOneOutcome> {
    const pageText = String(input.pageText || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!pageText) {
      return heuristicRecommend({
        useCustomizedResume: true,
        warning:
          'Page text is empty — open the job description page and try again.',
        reason: 'No page text.',
      });
    }

    if (!input.catalog.stackNames.length) {
      return heuristicRecommend({
        useCustomizedResume: true,
        warning:
          "No analyzed Library resumes. Analyze resumes in My Resume's Library first.",
        reason: 'Empty library catalog — use customized resume.',
      });
    }

    let auth: Awaited<ReturnType<ProfileLlmAuthService['resolve']>>;
    try {
      auth = await this.llmAuth.resolve({ applierName: input.applierName });
    } catch {
      return heuristicRecommend({
        useCustomizedResume: true,
        warning:
          'LLM unavailable — set an API key on the applier autoBidProfile.',
        reason: 'No LLM API key.',
      });
    }

    const allowedList = input.catalog.stackNames
      .map((s) => `- ${s}`)
      .join('\n');
    const requestId = randomUUID();
    const title = String(input.title || '').trim() || '(unknown)';
    const url = String(input.url || '').trim() || '(job)';
    const completion = await this.chat.chatCompletion({
      provider: auth.provider,
      apiKey: auth.apiKey,
      model: auth.model,
      jsonMode: true,
      jsonSchema: {
        name: RECOMMEND_RESUME_SCHEMA_NAME,
        schema: RECOMMEND_RESUME_JSON_SCHEMA as unknown as Record<
          string,
          unknown
        >,
        strict: true,
      },
      messages: [
        { role: 'system', content: RECOMMEND_RESUME_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `ALLOWED RESUME LABELS (pick exactly one or null):\n${allowedList}\n\nRESUME CATALOG:\n${input.catalog.text}\n\n=== PAGE TEXT ===\nURL: ${url}\nTitle: ${title}\n\n${pageText}`,
        },
      ],
      usageMeta: {
        feature: AI_USAGE_FEATURES.recommendResume,
        applierName: auth.applierName,
        jobId: String(input.jobId || ''),
        requestId,
        path: input.usagePath,
      },
    });

    const parsed = parseRecommendResumeResponse(completion.content);
    const usage = completion.usage
      ? { ...completion.usage, model: auth.model }
      : null;

    if (!parsed.isJobDescription) {
      return {
        result: {
          recommendedResume: null,
          matchedCatalogKey: null,
          useCustomizedResume: false,
          warning:
            'This page does not appear to contain a job description. Open the JD page and try again.',
          reason: parsed.reason || 'Not a job description.',
        },
        mode: 'llm',
        usage,
        requestId,
      };
    }

    const matchedCatalogKey = resolveCatalogKey(
      parsed.recommendedResume,
      input.catalog.stackNames,
    );
    const useCustomizedResume = !matchedCatalogKey;
    return {
      result: {
        recommendedResume: matchedCatalogKey,
        matchedCatalogKey,
        useCustomizedResume,
        warning: useCustomizedResume
          ? 'No Library stack matched — use customized resume.'
          : null,
        reason:
          parsed.reason ||
          (matchedCatalogKey ? `Matched ${matchedCatalogKey}.` : 'No match.'),
      },
      mode: 'llm',
      usage,
      requestId,
    };
  }
}
