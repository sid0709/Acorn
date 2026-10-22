import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  JOB_SKILL_QUEUE_STATUSES,
  JOB_TITLE_REVIEW_LABELS,
  TITLE_REVIEW_META_STATES,
  type TitleReviewMetaState,
} from './constants/job-pipeline.constants';

/**
 * Queue membership for title review / AI analyze is derived from temp_jobs
 * fields (no athens_metadata join).
 *
 * The Failed tab is keyed by nested metadata, so that filter uses
 * aggregateRaw / findRaw (Prisma Mongo JSON path filters are not reliable).
 */
@Injectable()
export class TempJobQueueService {
  constructor(private readonly prisma: PrismaService) {}

  /** Typed where for label-only tabs (pending / review_required). */
  titleReviewLabelWhere(
    state: Exclude<TitleReviewMetaState, 'failed'>,
  ): Prisma.TempJobWhereInput {
    if (state === TITLE_REVIEW_META_STATES.REVIEW_REQUIRED) {
      return { titleReviewLabel: JOB_TITLE_REVIEW_LABELS.REVIEW_REQUIRED };
    }
    return { titleReviewLabel: JOB_TITLE_REVIEW_LABELS.PENDING };
  }

  skillExtractWhere(): Prisma.TempJobWhereInput {
    return {
      titleReviewLabel: JOB_TITLE_REVIEW_LABELS.APPROVED,
      aiSkillStatus: {
        in: [...JOB_SKILL_QUEUE_STATUSES],
      },
    };
  }

  titleReviewMongoMatch(state: TitleReviewMetaState): Record<string, unknown> {
    if (state === TITLE_REVIEW_META_STATES.FAILED) {
      return { 'metadata.titleReview.processingState': 'failed' };
    }
    if (state === TITLE_REVIEW_META_STATES.REVIEW_REQUIRED) {
      return {
        titleReviewLabel: JOB_TITLE_REVIEW_LABELS.REVIEW_REQUIRED,
        'metadata.titleReview.processingState': { $ne: 'failed' },
      };
    }
    // Include AI-failed rows so they stay in Unreviewed and can be retried.
    return {
      titleReviewLabel: JOB_TITLE_REVIEW_LABELS.PENDING,
    };
  }

  async titleReviewCounts() {
    const [pending, reviewRequired, failed] = await Promise.all([
      this.countByMatch(
        this.titleReviewMongoMatch(TITLE_REVIEW_META_STATES.PENDING),
      ),
      this.countByMatch(
        this.titleReviewMongoMatch(TITLE_REVIEW_META_STATES.REVIEW_REQUIRED),
      ),
      this.countByMatch(
        this.titleReviewMongoMatch(TITLE_REVIEW_META_STATES.FAILED),
      ),
    ]);
    return {
      pending,
      unreviewedCount: pending,
      reviewRequiredCount: reviewRequired,
      failedCount: failed,
    };
  }

  async skillExtractPendingCount() {
    return this.prisma.tempJob.count({ where: this.skillExtractWhere() });
  }

  async countByMatch(match: Record<string, unknown>): Promise<number> {
    const raw = await this.prisma.tempJob.aggregateRaw({
      pipeline: [
        { $match: match },
        { $count: 'total' },
      ] as Prisma.InputJsonValue[],
    });
    const rows: unknown[] = Array.isArray(raw) ? raw : [];
    const first: unknown = rows[0];
    if (!first || typeof first !== 'object' || Array.isArray(first)) return 0;
    const total = (first as { total?: unknown }).total;
    return typeof total === 'number' ? total : 0;
  }
}
