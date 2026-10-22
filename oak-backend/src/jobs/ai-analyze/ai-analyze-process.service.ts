import { Injectable, Logger } from '@nestjs/common';
import type { ProfileLlmAuth } from '../../ai/auth/profile-llm-auth.service';
import { AI_ANALYZE_JD_MAX_CHARS } from '../../ai/constants/ai-concurrency.constants';
import { AiChatWithUsageService } from '../../ai-usage/ai-chat-with-usage.service';
import { AI_USAGE_FEATURES } from '../../ai-usage/constants/ai-usage.constants';
import type { ClaimedTempJob } from '../claim/claim-meta';
import { AiAnalyzeClaimService } from '../claim/ai-analyze-claim.service';
import { normalizeJobScrape } from '../mappers/job-metadata.mapper';
import { TempJobPromotionService } from '../temp-job-promotion.service';
import { asMetaRecord, mergeJobDetails } from './ai-analyze-merge';
import { parseAiAnalyzeJson } from './ai-analyze-parse';
import { JOB_AI_ANALYZE_PROMPT } from './ai-analyze.prompt';

export type AiAnalyzeBatchStats = {
  processed: number;
  extracted: number;
  failed: number;
  promoted: number;
  remoteReviewQueued: number;
};

@Injectable()
export class AiAnalyzeProcessService {
  private readonly logger = new Logger(AiAnalyzeProcessService.name);

  constructor(
    private readonly chat: AiChatWithUsageService,
    private readonly claims: AiAnalyzeClaimService,
    private readonly promotion: TempJobPromotionService,
  ) {}

  async analyzeAndPersistBatch(input: {
    jobs: ClaimedTempJob[];
    auth: ProfileLlmAuth;
    sessionId: string;
    signal?: AbortSignal;
  }): Promise<AiAnalyzeBatchStats> {
    const stats: AiAnalyzeBatchStats = {
      processed: 0,
      extracted: 0,
      failed: 0,
      promoted: 0,
      remoteReviewQueued: 0,
    };
    if (!input.jobs.length) return stats;

    const payload = input.jobs.map((job) => buildLlmJobInput(job));
    const ids = payload.map((p) => p.id);

    let content = '';
    try {
      const result = await this.chat.chatCompletion({
        apiKey: input.auth.apiKey,
        model: input.auth.model,
        provider: input.auth.provider,
        jsonMode: true,
        signal: input.signal,
        messages: [
          { role: 'system', content: JOB_AI_ANALYZE_PROMPT },
          { role: 'user', content: JSON.stringify({ jobs: payload }) },
        ],
        usageMeta: {
          feature: AI_USAGE_FEATURES.jobAiAnalyze,
          applierName: input.auth.applierName,
          runId: input.sessionId,
          path: '/jobs/ai-analyze',
        },
      });
      content = result.content;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const job of input.jobs) {
        await this.claims.persistFailure({
          id: job.id,
          sessionId: input.sessionId,
          code: 'LLM_ERROR',
          message,
        });
        stats.failed += 1;
        stats.processed += 1;
      }
      return stats;
    }

    const { valid, errors } = parseAiAnalyzeJson(content, ids);

    for (const job of input.jobs) {
      const parsed = valid.get(job.id);
      if (!parsed) {
        const err = errors.get(job.id);
        await this.claims.persistFailure({
          id: job.id,
          sessionId: input.sessionId,
          code: err?.code || 'MODEL_OUTPUT_INVALID',
          message: err?.message || 'AI analyze failed',
        });
        stats.failed += 1;
        stats.processed += 1;
        continue;
      }

      const meta = asMetaRecord(job.metadata);
      const merged = mergeJobDetails(meta.details, parsed.details, {
        confidence: parsed.remoteConfidence,
        reason: parsed.remoteReason,
      });
      meta.details = merged.details;
      if (merged.remoteReview) {
        meta.remoteReview = merged.remoteReview;
        stats.remoteReviewQueued += 1;
      } else {
        delete meta.remoteReview;
      }
      const aa = asMetaRecord(meta.aiAnalyze);
      delete aa.lease;
      aa.processingState = 'completed';
      aa.analyzedAt = new Date().toISOString();
      meta.aiAnalyze = aa;

      const ok = await this.claims.persistSuccess({
        id: job.id,
        sessionId: input.sessionId,
        metadata: meta,
        aiSkills: parsed.skills,
        applyLink: job.applyLink,
      });
      if (!ok) {
        await this.claims.persistFailure({
          id: job.id,
          sessionId: input.sessionId,
          code: 'PERSIST_FAILED',
          message: 'Could not save the AI analyze result.',
        });
        stats.failed += 1;
        stats.processed += 1;
        continue;
      }
      stats.extracted += 1;
      stats.processed += 1;

      try {
        const promoted = await this.promotion.promoteIfReady(job.id);
        if (promoted) stats.promoted += 1;
      } catch (err) {
        // Leave aiSkillStatus=extracted so the row stays in the UI queue
        // (JOB_SKILL_QUEUE_STATUSES) and the next AI analyze run promotes it.
        this.logger.warn(
          `promote failed for ${job.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return stats;
  }
}

function buildLlmJobInput(job: ClaimedTempJob) {
  const meta = asMetaRecord(job.metadata);
  const scrape = normalizeJobScrape(meta.scrape);
  const description = String(job.description || '').slice(
    0,
    AI_ANALYZE_JD_MAX_CHARS,
  );
  return {
    id: job.id,
    title: job.title,
    companyName: job.companyName,
    description,
    existingDetails: meta.details ?? null,
    scrapeHints: scrape
      ? {
          tags: scrape.tags,
          skills: scrape.skills,
          companyTags: scrape.companyTags,
        }
      : null,
  };
}
