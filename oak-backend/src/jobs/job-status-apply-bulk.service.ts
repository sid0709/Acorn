import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  objectIdIn,
  rawInsertMany,
  rawUpdateMany,
  withReplicaSetFallback,
} from '../prisma/mongo-standalone';
import {
  JOB_STATUS_STATES,
  type JobStatusState,
} from './constants/job-status-states.constants';
import { JobRecommendFieldsService } from './recommend/job-recommend-fields.service';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const MAX_APPLY = 500;
const JOB_STATUSES_COLLECTION = 'job_statuses';
const SKIP_ALWAYS = new Set<JobStatusState>([
  'applied',
  'scheduled',
  'declined',
]);
const SKIP_QUEUED = new Set<JobStatusState>([
  'bid-ready',
  'worker-pool',
  'bid-completed',
]);

/** Bulk upsert `job_statuses.state=applied` for one profile. */
@Injectable()
export class JobStatusApplyBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recommendFields: JobRecommendFieldsService,
  ) {}

  async setApplied(
    profileId: string,
    jobIds: string[],
    { skipQueued = true }: { skipQueued?: boolean } = {},
  ): Promise<string[]> {
    const ids = [
      ...new Set(
        jobIds
          .map((id) => String(id || '').trim())
          .filter((id) => OBJECT_ID_RE.test(id)),
      ),
    ].slice(0, MAX_APPLY);
    if (!ids.length) return [];

    const statuses = await this.prisma.jobStatus.findMany({
      where: { profileId, jobId: { in: ids } },
      select: { jobId: true, state: true },
    });
    const existing = new Map(statuses.map((row) => [row.jobId, row.state]));
    const toUpdate: string[] = [];
    const toInsert: string[] = [];
    for (const jobId of ids) {
      const state = existing.get(jobId);
      if (state != null && isSkipState(state, skipQueued)) continue;
      if (state == null) toInsert.push(jobId);
      else toUpdate.push(jobId);
    }

    const now = new Date();
    if (toUpdate.length) {
      await withReplicaSetFallback(
        async () => {
          await this.prisma.jobStatus.updateMany({
            where: { profileId, jobId: { in: toUpdate } },
            data: { state: 'applied' },
          });
        },
        async () => {
          await rawUpdateMany(
            this.prisma,
            JOB_STATUSES_COLLECTION,
            {
              profileId: { $oid: profileId },
              jobId: objectIdIn(toUpdate),
            },
            { state: 'applied', updatedAt: now },
          );
        },
      );
    }
    if (toInsert.length) {
      await rawInsertMany(
        this.prisma,
        JOB_STATUSES_COLLECTION,
        toInsert.map((jobId) => ({
          profileId: { $oid: profileId },
          jobId: { $oid: jobId },
          state: 'applied',
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
    const appliedIds = [...toUpdate, ...toInsert];
    if (appliedIds.length) {
      await this.recommendFields.persistAppliedSnapshots(profileId, appliedIds);
    }
    return appliedIds;
  }
}

function isSkipState(raw: string, skipQueued: boolean): boolean {
  const state = String(raw || '').trim();
  if (!(JOB_STATUS_STATES as readonly string[]).includes(state)) return false;
  const typed = state as JobStatusState;
  if (SKIP_ALWAYS.has(typed)) return true;
  return skipQueued && SKIP_QUEUED.has(typed);
}
