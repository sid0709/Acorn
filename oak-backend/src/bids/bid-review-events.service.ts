import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  deleteManyWithFallback,
  mongoFieldIdIn,
  mongoFieldIdQuery,
} from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';
import { isoOrNull } from './lib/iso';

/** Must match `@@map("bid_review_events")` on BidReviewEvent. */
const BID_REVIEW_EVENTS_COLLECTION = 'bid_review_events';

@Injectable()
export class BidReviewEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async append(input: {
    applierName: string;
    jobId: string;
    vendorTaskId?: string | null;
    eventType: string;
    eventKey?: string | null;
    meta?: Record<string, unknown> | null;
    feature?: string | null;
  }) {
    const eventKey =
      String(input.eventKey || '').trim() || `evt:${randomUUID()}`;
    try {
      return await this.prisma.bidReviewEvent.create({
        data: {
          applierName: input.applierName,
          jobId: input.jobId,
          vendorTaskId: input.vendorTaskId ?? null,
          eventType: input.eventType,
          eventKey,
          meta: (input.meta ?? undefined) as Prisma.InputJsonValue | undefined,
          feature: input.feature ?? null,
        },
      });
    } catch {
      // Unique eventKey — treat as idempotent no-op
      return this.prisma.bidReviewEvent.findFirst({
        where: {
          applierName: input.applierName,
          jobId: input.jobId,
          eventKey,
        },
      });
    }
  }

  async deleteForJob(applierName: string, jobId: string): Promise<number> {
    return deleteManyWithFallback(
      this.prisma,
      BID_REVIEW_EVENTS_COLLECTION,
      { $and: [{ applierName }, mongoFieldIdQuery('jobId', jobId)] },
      () =>
        this.prisma.bidReviewEvent.deleteMany({
          where: { applierName, jobId },
        }),
    );
  }

  /** Catalog hard-delete: drop review events for these jobs across every applier. */
  async deleteByJobIds(jobIds: string[]): Promise<number> {
    const ids = [
      ...new Set(jobIds.map((id) => String(id || '').trim()).filter(Boolean)),
    ];
    if (!ids.length) return 0;
    return deleteManyWithFallback(
      this.prisma,
      BID_REVIEW_EVENTS_COLLECTION,
      mongoFieldIdIn('jobId', ids),
      () =>
        this.prisma.bidReviewEvent.deleteMany({
          where: { jobId: { in: ids } },
        }),
    );
  }

  async listForJob(applierName: string, jobId: string, limit = 100) {
    const rows = await this.prisma.bidReviewEvent.findMany({
      where: { applierName, jobId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      applierName: row.applierName,
      jobId: row.jobId,
      vendorTaskId: row.vendorTaskId,
      eventType: row.eventType,
      eventKey: row.eventKey,
      meta: row.meta,
      feature: row.feature,
      createdAt: isoOrNull(row.createdAt),
    }));
  }
}
