import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterJobService } from './register-job.service';
import { isJobCatalogReady } from './constants/job-catalog-readiness.constants';
import {
  JOB_SKILL_PROMOTE_ONLY_STATUSES,
  JOB_TITLE_REVIEW_LABELS,
} from './constants/job-pipeline.constants';

/**
 * Moves a ready TempJob into `jobs` via registerJob (delete from temp).
 * AI pipelines call this after both title review and AI analyze complete.
 */
@Injectable()
export class TempJobPromotionService {
  constructor(
    private readonly registerJobs: RegisterJobService,
    private readonly prisma: PrismaService,
  ) {}

  isReady(job: {
    titleReviewLabel: string;
    aiSkillStatus: string | null | undefined;
  }) {
    return isJobCatalogReady(job);
  }

  /** Move one temp row into jobs when ready. Returns false if missing or not ready. */
  async promoteIfReady(tempJobId: string): Promise<boolean> {
    return this.registerJobs.registerJob(tempJobId);
  }

  /**
   * Promote up to `limit` catalog-ready rows still stuck in temp_jobs.
   * Used on AI analyze start and by the one-shot promote script.
   */
  async promoteReadyBatch(limit: number): Promise<{
    attempted: number;
    promoted: number;
    failed: number;
  }> {
    const take = Math.max(1, Math.min(Number(limit) || 1, 500));
    const rows = await this.prisma.tempJob.findMany({
      where: {
        titleReviewLabel: JOB_TITLE_REVIEW_LABELS.APPROVED,
        aiSkillStatus: { in: [...JOB_SKILL_PROMOTE_ONLY_STATUSES] },
      },
      select: { id: true },
      orderBy: { postedAt: 'desc' },
      take,
    });

    let promoted = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        if (await this.promoteIfReady(row.id)) promoted += 1;
      } catch {
        failed += 1;
      }
    }
    return { attempted: rows.length, promoted, failed };
  }
}
