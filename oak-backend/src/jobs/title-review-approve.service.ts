import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  TEMP_JOBS_COLLECTION,
  asInputJson,
  asMetaObject,
  modifiedCount,
} from './claim/claim-meta';
import {
  JOB_AI_SKILL_STATUSES,
  JOB_TITLE_REVIEW_LABELS,
  TITLE_REVIEW_PROCESSING_STATES,
} from './constants/job-pipeline.constants';
import { normalizeJobIds } from './lib/normalize-job-ids';
import { resolveCatalogSource } from './lib/resolve-catalog-source';

export type ApproveTitleReviewResult = {
  success: true;
  approvedCount: number;
  approvedIds: string[];
};

/**
 * Manual title approval: sets `titleReviewLabel=APPROVED` so the job enters
 * the AI Analyze queue (claim requires APPROVED + open aiSkillStatus).
 */
@Injectable()
export class TitleReviewApproveService {
  constructor(private readonly prisma: PrismaService) {}

  async approve(rawIds: unknown): Promise<ApproveTitleReviewResult> {
    const ids = normalizeJobIds(rawIds);
    const approvedIds: string[] = [];
    for (const id of ids) {
      if (await this.approveOne(id)) approvedIds.push(id);
    }
    return {
      success: true,
      approvedCount: approvedIds.length,
      approvedIds,
    };
  }

  private async approveOne(id: string): Promise<boolean> {
    const row = await this.prisma.tempJob.findUnique({
      where: { id },
      select: {
        title: true,
        titleReviewLabel: true,
        aiSkillStatus: true,
        applyLink: true,
        metadata: true,
      },
    });
    if (!row) return false;

    if (row.titleReviewLabel === JOB_TITLE_REVIEW_LABELS.APPROVED) {
      return true;
    }

    const meta = asMetaObject(row.metadata);
    const prev = asMetaObject(meta.titleReview);
    meta.titleReview = {
      processingState: TITLE_REVIEW_PROCESSING_STATES.COMPLETED,
      label: JOB_TITLE_REVIEW_LABELS.APPROVED,
      ...(typeof prev.aiLabel === 'string' ? { aiLabel: prev.aiLabel } : {}),
      originalTitle:
        typeof prev.originalTitle === 'string' ? prev.originalTitle : row.title,
      ...(typeof prev.confidence === 'number'
        ? { confidence: prev.confidence }
        : {}),
      reason:
        typeof prev.reason === 'string' && prev.reason.trim()
          ? prev.reason
          : 'Manually approved',
      decisionSource: 'manual',
      classifiedAt: new Date().toISOString(),
    };

    const setFields = {
      titleReviewLabel: JOB_TITLE_REVIEW_LABELS.APPROVED,
      source: resolveCatalogSource(row.applyLink),
      metadata: asInputJson(meta),
      updatedAt: { $date: new Date().toISOString() },
      // Ensure claimable for AI Analyze when skill status was never set.
      ...(!row.aiSkillStatus
        ? { aiSkillStatus: JOB_AI_SKILL_STATUSES.PENDING }
        : {}),
    };

    const result = await this.prisma.$runCommandRaw({
      update: TEMP_JOBS_COLLECTION,
      updates: [
        {
          q: {
            _id: { $oid: id },
            titleReviewLabel: { $ne: JOB_TITLE_REVIEW_LABELS.APPROVED },
          },
          u: { $set: setFields },
          multi: false,
        },
      ],
    });

    // Race: another writer may have approved between read and update.
    if (modifiedCount(result) > 0) return true;
    const again = await this.prisma.tempJob.findUnique({
      where: { id },
      select: { titleReviewLabel: true },
    });
    return again?.titleReviewLabel === JOB_TITLE_REVIEW_LABELS.APPROVED;
  }
}
