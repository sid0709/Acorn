import { Injectable } from '@nestjs/common';
import type { Job } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  deleteManyWithFallback,
  mongoFieldIdQuery,
  rawInsertOne,
  rawUpdateMany,
  isInconsistentDateTime,
  repairStringDateFields,
  withReplicaSetFallback,
} from '../prisma/mongo-standalone';
import type { JobStatusState } from '../jobs/constants/job-status-states.constants';
import { BidReviewEventsService } from './bid-review-events.service';
import { VendorTaskService } from './vendor-task.service';

const JOB_STATUSES_COLLECTION = 'job_statuses';

/** DateTime fields that raw fallbacks must store as BSON Date (not ISO strings). */
const JOB_STATUS_DATE_FIELDS = [
  'bidReadyAt',
  'bidCompletedAt',
  'postedAt',
  'recommendedAt',
  'createdAt',
  'updatedAt',
] as const;

/**
 * JobStatus bid transitions with stable bidReadyAt + vendor_tasks stub.
 * Used by JobStatusMutateService and Lens bid lifecycle.
 */
@Injectable()
export class BidStatusQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vendorTasks: VendorTaskService,
    private readonly events: BidReviewEventsService,
  ) {}

  async setBidReady(input: {
    profileId: string;
    applierName: string;
    job: Job;
  }): Promise<{ bidReadyAt: Date; changed: boolean }> {
    const { profileId, job, applierName } = input;
    const existing = await this.findStatusRow(profileId, job.id);

    const now = new Date();
    const bidReadyAt = existing?.bidReadyAt ?? now;
    const previous = existing?.state ?? null;
    const changed = previous !== 'bid-ready';

    if (existing) {
      await withReplicaSetFallback(
        async () => {
          await this.prisma.jobStatus.update({
            where: { profileId_jobId: { profileId, jobId: job.id } },
            data: {
              state: 'bid-ready',
              bidReadyAt: existing.bidReadyAt ?? now,
              postedAt: existing.postedAt ?? job.postedAt,
              bidCompletedAt: null,
            },
          });
        },
        async () => {
          await rawUpdateMany(
            this.prisma,
            JOB_STATUSES_COLLECTION,
            {
              profileId: { $oid: profileId },
              jobId: { $oid: job.id },
            },
            {
              state: 'bid-ready',
              bidReadyAt: existing.bidReadyAt ?? now,
              postedAt: existing.postedAt ?? job.postedAt,
              bidCompletedAt: null,
              updatedAt: now,
            },
          );
        },
      );
    } else {
      await withReplicaSetFallback(
        async () => {
          await this.prisma.jobStatus.create({
            data: {
              profileId,
              jobId: job.id,
              state: 'bid-ready',
              bidReadyAt,
              postedAt: job.postedAt,
            },
          });
        },
        () =>
          rawInsertOne(this.prisma, JOB_STATUSES_COLLECTION, {
            profileId: { $oid: profileId },
            jobId: { $oid: job.id },
            state: 'bid-ready',
            bidReadyAt,
            postedAt: job.postedAt,
            createdAt: now,
            updatedAt: now,
          }),
      );
    }

    await this.vendorTasks.upsertBidReadyStub({
      applierName,
      job,
      bidReadyDate: bidReadyAt,
    });

    return { bidReadyAt, changed };
  }

  async setBidCompleted(input: {
    profileId: string;
    job: Job;
    existingBidReadyAt?: Date | null;
  }): Promise<void> {
    const { profileId, job } = input;
    const existing = await this.findStatusRow(profileId, job.id);
    const now = new Date();
    const bidReadyAt = existing?.bidReadyAt ?? input.existingBidReadyAt ?? now;

    if (existing) {
      await withReplicaSetFallback(
        async () => {
          await this.prisma.jobStatus.update({
            where: { profileId_jobId: { profileId, jobId: job.id } },
            data: {
              state: 'bid-completed',
              bidReadyAt,
              bidCompletedAt: existing.bidCompletedAt ?? now,
              postedAt: existing.postedAt ?? job.postedAt,
            },
          });
        },
        async () => {
          await rawUpdateMany(
            this.prisma,
            JOB_STATUSES_COLLECTION,
            {
              profileId: { $oid: profileId },
              jobId: { $oid: job.id },
            },
            {
              state: 'bid-completed',
              bidReadyAt,
              bidCompletedAt: existing.bidCompletedAt ?? now,
              postedAt: existing.postedAt ?? job.postedAt,
              updatedAt: now,
            },
          );
        },
      );
      return;
    }

    await withReplicaSetFallback(
      async () => {
        await this.prisma.jobStatus.create({
          data: {
            profileId,
            jobId: job.id,
            state: 'bid-completed',
            bidReadyAt,
            bidCompletedAt: now,
            postedAt: job.postedAt,
          },
        });
      },
      () =>
        rawInsertOne(this.prisma, JOB_STATUSES_COLLECTION, {
          profileId: { $oid: profileId },
          jobId: { $oid: job.id },
          state: 'bid-completed',
          bidReadyAt,
          bidCompletedAt: now,
          postedAt: job.postedAt,
          createdAt: now,
          updatedAt: now,
        }),
    );
  }

  async getBidReadyAt(profileId: string, jobId: string): Promise<Date | null> {
    try {
      const row = await this.prisma.jobStatus.findUnique({
        where: { profileId_jobId: { profileId, jobId } },
        select: { bidReadyAt: true },
      });
      return row?.bidReadyAt ?? null;
    } catch (error) {
      if (!isInconsistentDateTime(error)) throw error;
      await repairStringDateFields(this.prisma, JOB_STATUSES_COLLECTION, [
        ...JOB_STATUS_DATE_FIELDS,
      ]);
      const row = await this.prisma.jobStatus.findUnique({
        where: { profileId_jobId: { profileId, jobId } },
        select: { bidReadyAt: true },
      });
      return row?.bidReadyAt ?? null;
    }
  }

  async listQueue(
    profileId: string,
    opts: { includeCompleted: boolean; limit: number },
  ) {
    const states: JobStatusState[] = opts.includeCompleted
      ? ['bid-ready', 'bid-completed']
      : ['bid-ready'];
    try {
      return await this.prisma.jobStatus.findMany({
        where: { profileId, state: { in: states } },
        orderBy: [{ postedAt: 'desc' }, { updatedAt: 'desc' }],
        take: opts.limit,
      });
    } catch (error) {
      // Standalone raw writes once stored ISO strings; heal then retry.
      if (!isInconsistentDateTime(error)) throw error;
      await repairStringDateFields(this.prisma, JOB_STATUSES_COLLECTION, [
        ...JOB_STATUS_DATE_FIELDS,
      ]);
      return this.prisma.jobStatus.findMany({
        where: { profileId, state: { in: states } },
        orderBy: [{ postedAt: 'desc' }, { updatedAt: 'desc' }],
        take: opts.limit,
      });
    }
  }

  /**
   * Move to New: drop job_statuses plus Bid Ready vendor_tasks / review events.
   * Inverse of setBidReady — Bid Management and Lens must not keep the stub.
   */
  async clearBidReady(input: {
    profileId: string;
    applierName: string;
    jobId: string;
  }): Promise<{ changed: boolean }> {
    const statusDeleted = await this.clearStatus(input.profileId, input.jobId);
    const tasksDeleted = await this.vendorTasks.deleteByApplierJob(
      input.applierName,
      input.jobId,
    );
    const eventsDeleted = await this.events.deleteForJob(
      input.applierName,
      input.jobId,
    );
    return {
      changed: statusDeleted + tasksDeleted + eventsDeleted > 0,
    };
  }

  async clearStatus(profileId: string, jobId: string): Promise<number> {
    return deleteManyWithFallback(
      this.prisma,
      JOB_STATUSES_COLLECTION,
      {
        $and: [
          mongoFieldIdQuery('profileId', profileId),
          mongoFieldIdQuery('jobId', jobId),
        ],
      },
      () =>
        this.prisma.jobStatus.deleteMany({
          where: { profileId, jobId },
        }),
    );
  }

  private async findStatusRow(profileId: string, jobId: string) {
    try {
      return await this.prisma.jobStatus.findUnique({
        where: { profileId_jobId: { profileId, jobId } },
      });
    } catch (error) {
      if (!isInconsistentDateTime(error)) throw error;
      await repairStringDateFields(this.prisma, JOB_STATUSES_COLLECTION, [
        ...JOB_STATUS_DATE_FIELDS,
      ]);
      return this.prisma.jobStatus.findUnique({
        where: { profileId_jobId: { profileId, jobId } },
      });
    }
  }
}
