import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  isInconsistentDateTime,
  rawUpdateMany,
  repairStringDateFields,
  withReplicaSetFallback,
} from '../../prisma/mongo-standalone';
import { PrismaService } from '../../prisma/prisma.service';
import { JOB_OBJECT_ID_PATTERN } from '../lib/normalize-job-ids';
import {
  hasStoredRecommendation,
  mapVendorTaskRecommendFields,
  recommendFieldsToStatusWrite,
  type JobRecommendFields,
} from './job-recommend-fields.mapper';

const JOB_STATUSES_COLLECTION = 'job_statuses';

const RECOMMEND_SELECT = {
  jobId: true,
  recommendedResumeStack: true,
  recommendedResumeId: true,
  recommendedResumeReason: true,
  useCustomizedResume: true,
  recommendWarning: true,
  recommendedAt: true,
  recommendMode: true,
} as const;

/**
 * Per-applier Recommend snapshot on job_statuses.
 * Survives vendor_tasks being dropped after apply.
 */
@Injectable()
export class JobRecommendStatusStore {
  constructor(private readonly prisma: PrismaService) {}

  async loadForProfile(
    profileId: string,
    jobIds: string[],
  ): Promise<Map<string, JobRecommendFields>> {
    const out = new Map<string, JobRecommendFields>();
    const id = String(profileId || '').trim();
    const ids = [
      ...new Set(
        jobIds
          .map((jobId) => String(jobId || '').trim())
          .filter((jobId) => JOB_OBJECT_ID_PATTERN.test(jobId)),
      ),
    ];
    if (!id || !ids.length) return out;

    const rows = await this.findRows(id, ids);
    for (const row of rows) {
      if (!hasStoredRecommendation(row)) continue;
      const jobId = String(row.jobId || '').trim();
      if (!jobId) continue;
      const fields = mapVendorTaskRecommendFields(row);
      out.set(jobId, fields);
      out.set(jobId.toLowerCase(), fields);
    }
    return out;
  }

  async writeMany(
    profileId: string,
    byJobId: Map<string, JobRecommendFields>,
  ): Promise<void> {
    const id = String(profileId || '').trim();
    if (!id || byJobId.size === 0) return;

    const seen = new Set<string>();
    const writes: Promise<void>[] = [];
    for (const [jobId, fields] of byJobId) {
      const key = jobId.toLowerCase();
      if (seen.has(key) || !JOB_OBJECT_ID_PATTERN.test(jobId)) continue;
      if (!hasStoredRecommendation(fields)) continue;
      seen.add(key);
      writes.push(this.writeOne(id, jobId, fields));
    }
    if (writes.length) await Promise.all(writes);
  }

  private async writeOne(
    profileId: string,
    jobId: string,
    fields: JobRecommendFields,
  ): Promise<void> {
    const data = recommendFieldsToStatusWrite(fields);
    try {
      await withReplicaSetFallback(
        async () => {
          await this.prisma.jobStatus.update({
            where: { profileId_jobId: { profileId, jobId } },
            data,
          });
        },
        async () => {
          await rawUpdateMany(
            this.prisma,
            JOB_STATUSES_COLLECTION,
            {
              profileId: { $oid: profileId },
              jobId: { $oid: jobId },
            },
            { ...data, updatedAt: new Date() },
          );
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        return;
      }
      throw error;
    }
  }

  private async findRows(profileId: string, jobIds: string[]) {
    try {
      return await this.prisma.jobStatus.findMany({
        where: { profileId, jobId: { in: jobIds } },
        select: RECOMMEND_SELECT,
      });
    } catch (error) {
      if (!isInconsistentDateTime(error)) throw error;
      await repairStringDateFields(this.prisma, JOB_STATUSES_COLLECTION, [
        'recommendedAt',
        'bidReadyAt',
        'bidCompletedAt',
        'postedAt',
        'workerPoolAt',
        'createdAt',
        'updatedAt',
      ]);
      return this.prisma.jobStatus.findMany({
        where: { profileId, jobId: { in: jobIds } },
        select: RECOMMEND_SELECT,
      });
    }
  }
}
