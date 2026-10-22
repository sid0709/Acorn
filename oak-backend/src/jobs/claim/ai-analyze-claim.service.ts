import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AI_STALE_CLAIM_MS } from '../../ai/constants/ai-concurrency.constants';
import { rawUpdateMany } from '../../prisma/mongo-standalone';
import { PrismaService } from '../../prisma/prisma.service';
import {
  JOB_AI_SKILL_STATUSES,
  JOB_SKILL_EXTRACT_OPEN_STATUSES,
  JOB_TITLE_REVIEW_LABELS,
} from '../constants/job-pipeline.constants';
import { resolveCatalogSource } from '../lib/resolve-catalog-source';
import {
  TEMP_JOBS_COLLECTION,
  asMetaObject,
  asInputJson,
  leaseSessionId,
  modifiedCount,
  type ClaimedTempJob,
} from './claim-meta';

@Injectable()
export class AiAnalyzeClaimService {
  constructor(private readonly prisma: PrismaService) {}

  async claimWave(
    sessionId: string,
    limit: number,
    excludeIds: string[] = [],
  ): Promise<ClaimedTempJob[]> {
    await this.releaseStaleLeases();
    const candidates = await this.prisma.tempJob.findMany({
      where: {
        titleReviewLabel: JOB_TITLE_REVIEW_LABELS.APPROVED,
        aiSkillStatus: { in: [...JOB_SKILL_EXTRACT_OPEN_STATUSES] },
        ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
      },
      orderBy: { postedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        companyName: true,
        description: true,
        applyLink: true,
        source: true,
        metadata: true,
        titleReviewLabel: true,
        aiSkillStatus: true,
      },
    });

    const claimed: ClaimedTempJob[] = [];
    const now = new Date().toISOString();
    for (const row of candidates) {
      if (!(await this.tryClaim(row.id, sessionId, now))) continue;
      claimed.push({
        ...row,
        aiSkillStatus: JOB_AI_SKILL_STATUSES.ANALYZING,
      });
    }
    return claimed;
  }

  async persistSuccess(input: {
    id: string;
    sessionId: string;
    metadata: Record<string, unknown>;
    aiSkills: unknown;
    applyLink?: string | null;
  }): Promise<boolean> {
    const source = resolveCatalogSource(input.applyLink);
    const result = await this.prisma.$runCommandRaw({
      update: TEMP_JOBS_COLLECTION,
      updates: [
        {
          q: {
            _id: { $oid: input.id },
            aiSkillStatus: JOB_AI_SKILL_STATUSES.ANALYZING,
            'metadata.aiAnalyze.lease.sessionId': input.sessionId,
          },
          u: {
            $set: {
              aiSkillStatus: JOB_AI_SKILL_STATUSES.EXTRACTED,
              source,
              aiSkills: input.aiSkills as Prisma.InputJsonValue,
              metadata: asInputJson(input.metadata),
              updatedAt: { $date: new Date().toISOString() },
            },
          },
          multi: false,
        },
      ],
    });
    return modifiedCount(result) > 0;
  }

  /**
   * AI/parse failures return the job to pending (unanalyzed).
   * The current session skips it via excludeIds; the next run can retry.
   */
  async persistFailure(input: {
    id: string;
    sessionId: string;
    code: string;
    message: string;
  }): Promise<boolean> {
    const row = await this.prisma.tempJob.findUnique({
      where: { id: input.id },
      select: { metadata: true },
    });
    if (
      !row ||
      leaseSessionId(asMetaObject(row.metadata).aiAnalyze) !== input.sessionId
    ) {
      return false;
    }

    const meta = asMetaObject(row.metadata);
    const aa = asMetaObject(meta.aiAnalyze);
    delete aa.lease;
    delete aa.error;
    aa.processingState = 'pending';
    aa.lastAttempt = {
      sessionId: input.sessionId,
      code: input.code.slice(0, 80),
      message: input.message.slice(0, 500),
      failedAt: new Date().toISOString(),
    };
    meta.aiAnalyze = aa;

    const result = await this.prisma.$runCommandRaw({
      update: TEMP_JOBS_COLLECTION,
      updates: [
        {
          q: {
            _id: { $oid: input.id },
            'metadata.aiAnalyze.lease.sessionId': input.sessionId,
          },
          u: {
            $set: {
              aiSkillStatus: JOB_AI_SKILL_STATUSES.PENDING,
              metadata: asInputJson(meta),
              updatedAt: { $date: new Date().toISOString() },
            },
          },
          multi: false,
        },
      ],
    });
    return modifiedCount(result) > 0;
  }

  async releaseSession(sessionId: string): Promise<number> {
    const rows = await this.prisma.tempJob.findMany({
      where: { aiSkillStatus: JOB_AI_SKILL_STATUSES.ANALYZING },
      select: { id: true, metadata: true },
    });
    let released = 0;
    for (const row of rows) {
      if (leaseSessionId(asMetaObject(row.metadata).aiAnalyze) !== sessionId) {
        continue;
      }
      const meta = asMetaObject(row.metadata);
      const aa = asMetaObject(meta.aiAnalyze);
      delete aa.lease;
      aa.processingState = 'pending';
      meta.aiAnalyze = aa;
      await this.writeReleased(row.id, meta);
      released += 1;
    }
    return released;
  }

  private async tryClaim(
    id: string,
    sessionId: string,
    now: string,
  ): Promise<boolean> {
    const row = await this.prisma.tempJob.findUnique({
      where: { id },
      select: { metadata: true, aiSkillStatus: true, titleReviewLabel: true },
    });
    if (
      !row ||
      row.titleReviewLabel !== JOB_TITLE_REVIEW_LABELS.APPROVED ||
      !(JOB_SKILL_EXTRACT_OPEN_STATUSES as readonly string[]).includes(
        String(row.aiSkillStatus ?? ''),
      )
    ) {
      return false;
    }

    const meta = asMetaObject(row.metadata);
    meta.aiAnalyze = {
      processingState: 'analyzing',
      lease: { sessionId, claimedAt: now },
    };

    const result = await this.prisma.$runCommandRaw({
      update: TEMP_JOBS_COLLECTION,
      updates: [
        {
          q: {
            _id: { $oid: id },
            titleReviewLabel: JOB_TITLE_REVIEW_LABELS.APPROVED,
            aiSkillStatus: { $in: [...JOB_SKILL_EXTRACT_OPEN_STATUSES] },
          },
          u: {
            $set: {
              aiSkillStatus: JOB_AI_SKILL_STATUSES.ANALYZING,
              metadata: asInputJson(meta),
              updatedAt: { $date: new Date().toISOString() },
            },
          },
          multi: false,
        },
      ],
    });
    return modifiedCount(result) > 0;
  }

  private async releaseStaleLeases(): Promise<void> {
    const cutoff = new Date(Date.now() - AI_STALE_CLAIM_MS).toISOString();
    const rows = await this.prisma.tempJob.findMany({
      where: { aiSkillStatus: JOB_AI_SKILL_STATUSES.ANALYZING },
      select: { id: true, metadata: true },
    });
    for (const row of rows) {
      const meta = asMetaObject(row.metadata);
      const aa = asMetaObject(meta.aiAnalyze);
      const lease = asMetaObject(aa.lease);
      const claimedAt =
        typeof lease.claimedAt === 'string' ? lease.claimedAt : '';
      if (!claimedAt || claimedAt >= cutoff) continue;
      delete aa.lease;
      aa.processingState = 'pending';
      meta.aiAnalyze = aa;
      await this.writeReleased(row.id, meta);
    }
  }

  /** Prisma `update` needs a replica set; local AthensDB is often standalone. */
  private async writeReleased(
    id: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await rawUpdateMany(
      this.prisma,
      TEMP_JOBS_COLLECTION,
      { _id: { $oid: id } },
      {
        aiSkillStatus: JOB_AI_SKILL_STATUSES.PENDING,
        metadata: asInputJson(metadata),
        updatedAt: new Date(),
      },
    );
  }
}
