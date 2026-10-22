import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AI_STALE_CLAIM_MS } from '../../ai/constants/ai-concurrency.constants';
import { mongoFieldIdNin, rawUpdateMany } from '../../prisma/mongo-standalone';
import { PrismaService } from '../../prisma/prisma.service';
import {
  JOB_TITLE_REVIEW_LABELS,
  TITLE_REVIEW_PROCESSING_STATES,
} from '../constants/job-pipeline.constants';
import { resolveCatalogSource } from '../lib/resolve-catalog-source';
import {
  TEMP_JOBS_COLLECTION,
  asMetaObject,
  asObjectIdHex,
  asInputJson,
  isStaleClaimedAt,
  leaseSessionId,
  modifiedCount,
  type ClaimedTempJob,
} from './claim-meta';

@Injectable()
export class TitleReviewClaimService {
  constructor(private readonly prisma: PrismaService) {}

  async claimWave(
    sessionId: string,
    limit: number,
    excludeIds: string[] = [],
  ): Promise<ClaimedTempJob[]> {
    await this.releaseStaleLeases();
    const ids = await this.findCandidateIds(limit, excludeIds);
    const claimed: ClaimedTempJob[] = [];
    const now = new Date().toISOString();

    for (const id of ids) {
      if (!(await this.tryClaim(id, sessionId, now))) continue;
      const row = await this.prisma.tempJob.findUnique({
        where: { id },
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
      if (row) claimed.push(row);
    }
    return claimed;
  }

  async persistSuccess(input: {
    id: string;
    sessionId: string;
    title: string;
    label: 'APPROVED' | 'REVIEW_REQUIRED';
    confidence: number;
    reason: string;
  }): Promise<boolean> {
    const row = await this.prisma.tempJob.findUnique({
      where: { id: input.id },
      select: { metadata: true, title: true, applyLink: true },
    });
    if (!row || row.title !== input.title) return false;
    if (
      leaseSessionId(asMetaObject(row.metadata).titleReview) !== input.sessionId
    ) {
      return false;
    }

    const meta = asMetaObject(row.metadata);
    meta.titleReview = {
      processingState: TITLE_REVIEW_PROCESSING_STATES.COMPLETED,
      label: input.label,
      aiLabel: input.label,
      originalTitle: input.title,
      confidence: input.confidence,
      reason: input.reason,
      decisionSource: 'ai',
      classifiedAt: new Date().toISOString(),
    };

    const source = resolveCatalogSource(row.applyLink);

    const result = await this.prisma.$runCommandRaw({
      update: TEMP_JOBS_COLLECTION,
      updates: [
        {
          q: {
            _id: { $oid: input.id },
            title: input.title,
            'metadata.titleReview.lease.sessionId': input.sessionId,
          },
          u: {
            $set: {
              titleReviewLabel: input.label,
              source,
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

  /**
   * AI/parse failures return the job to pending so it stays Unreviewed.
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
      leaseSessionId(asMetaObject(row.metadata).titleReview) !== input.sessionId
    ) {
      return false;
    }

    const meta = asMetaObject(row.metadata);
    const tr = asMetaObject(meta.titleReview);
    delete tr.lease;
    delete tr.error;
    tr.processingState = TITLE_REVIEW_PROCESSING_STATES.PENDING;
    tr.lastAttempt = {
      sessionId: input.sessionId,
      code: input.code.slice(0, 80),
      message: input.message.slice(0, 500),
      failedAt: new Date().toISOString(),
    };
    meta.titleReview = tr;

    const result = await this.prisma.$runCommandRaw({
      update: TEMP_JOBS_COLLECTION,
      updates: [
        {
          q: {
            _id: { $oid: input.id },
            'metadata.titleReview.lease.sessionId': input.sessionId,
          },
          u: {
            $set: {
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
    const ids = await this.findIdsByMatch({
      'metadata.titleReview.lease.sessionId': sessionId,
      'metadata.titleReview.processingState':
        TITLE_REVIEW_PROCESSING_STATES.SCANNING,
    });
    let released = 0;
    for (const id of ids) {
      const row = await this.prisma.tempJob.findUnique({
        where: { id },
        select: { metadata: true },
      });
      if (!row) continue;
      const meta = asMetaObject(row.metadata);
      const tr = asMetaObject(meta.titleReview);
      delete tr.lease;
      tr.processingState = TITLE_REVIEW_PROCESSING_STATES.PENDING;
      meta.titleReview = tr;
      await this.writeReleased(id, meta);
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
      select: { metadata: true, titleReviewLabel: true },
    });
    if (!row || row.titleReviewLabel !== JOB_TITLE_REVIEW_LABELS.PENDING) {
      return false;
    }
    const meta = asMetaObject(row.metadata);
    const tr = asMetaObject(meta.titleReview);
    if (
      tr.processingState === TITLE_REVIEW_PROCESSING_STATES.SCANNING &&
      !isStaleClaimedAt(tr.lease, AI_STALE_CLAIM_MS)
    ) {
      return false;
    }

    meta.titleReview = {
      ...tr,
      processingState: TITLE_REVIEW_PROCESSING_STATES.SCANNING,
      lease: { sessionId, claimedAt: now },
    };
    delete (meta.titleReview as Record<string, unknown>).error;

    const result = await this.prisma.$runCommandRaw({
      update: TEMP_JOBS_COLLECTION,
      updates: [
        {
          q: {
            _id: { $oid: id },
            titleReviewLabel: JOB_TITLE_REVIEW_LABELS.PENDING,
            $or: [
              {
                'metadata.titleReview.processingState': {
                  $ne: TITLE_REVIEW_PROCESSING_STATES.SCANNING,
                },
              },
              { 'metadata.titleReview.processingState': { $exists: false } },
              {
                'metadata.titleReview.lease.claimedAt': {
                  $lt: new Date(Date.now() - AI_STALE_CLAIM_MS).toISOString(),
                },
              },
            ],
          },
          u: {
            $set: {
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

  private async findCandidateIds(
    limit: number,
    excludeIds: string[],
  ): Promise<string[]> {
    const raw = await this.prisma.tempJob.findRaw({
      filter: {
        titleReviewLabel: JOB_TITLE_REVIEW_LABELS.PENDING,
        ...(excludeIds.length
          ? (mongoFieldIdNin('_id', excludeIds) as Record<string, unknown>)
          : {}),
        $or: [
          {
            'metadata.titleReview.processingState': {
              $ne: TITLE_REVIEW_PROCESSING_STATES.SCANNING,
            },
          },
          { 'metadata.titleReview.processingState': { $exists: false } },
          {
            'metadata.titleReview.lease.claimedAt': {
              $lt: new Date(Date.now() - AI_STALE_CLAIM_MS).toISOString(),
            },
          },
        ],
      } as Prisma.InputJsonValue,
      options: {
        projection: { _id: 1 },
        sort: { postedAt: -1 },
        limit,
      } as Prisma.InputJsonValue,
    });
    return (Array.isArray(raw) ? raw : [])
      .map((row) => asObjectIdHex((row as { _id?: unknown })._id))
      .filter((id): id is string => Boolean(id));
  }

  private async findIdsByMatch(
    match: Record<string, unknown>,
  ): Promise<string[]> {
    const raw = await this.prisma.tempJob.findRaw({
      filter: match as Prisma.InputJsonValue,
      options: { projection: { _id: 1 }, limit: 500 } as Prisma.InputJsonValue,
    });
    return (Array.isArray(raw) ? raw : [])
      .map((row) => asObjectIdHex((row as { _id?: unknown })._id))
      .filter((id): id is string => Boolean(id));
  }

  private async releaseStaleLeases(): Promise<void> {
    const cutoff = new Date(Date.now() - AI_STALE_CLAIM_MS).toISOString();
    const ids = await this.findIdsByMatch({
      'metadata.titleReview.processingState':
        TITLE_REVIEW_PROCESSING_STATES.SCANNING,
      'metadata.titleReview.lease.claimedAt': { $lt: cutoff },
    });
    for (const id of ids) {
      const row = await this.prisma.tempJob.findUnique({
        where: { id },
        select: { metadata: true },
      });
      if (!row) continue;
      const meta = asMetaObject(row.metadata);
      const tr = asMetaObject(meta.titleReview);
      delete tr.lease;
      tr.processingState = TITLE_REVIEW_PROCESSING_STATES.PENDING;
      meta.titleReview = tr;
      await this.writeReleased(id, meta);
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
        metadata: asInputJson(metadata),
        updatedAt: new Date(),
      },
    );
  }
}
