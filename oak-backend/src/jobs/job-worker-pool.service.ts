import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BidStatusQueueService } from '../bids/bid-status-queue.service';
import {
  rawInsertOne,
  rawUpdateMany,
  withReplicaSetFallback,
} from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';
import type { JobStatusState } from './constants/job-status-states.constants';
import { mapJobToListDoc } from './mappers/job-list.mapper';
import { JobRecommendFieldsService } from './recommend/job-recommend-fields.service';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const MAX_BULK = 150;
const JOB_STATUSES_COLLECTION = 'job_statuses';
const WORKER_POOL: JobStatusState = 'worker-pool';

type MutateResult = {
  success: true;
  data: Record<string, unknown>;
  changed: boolean;
  viewerStatus: JobStatusState;
  mutationId: string | null;
};

@Injectable()
export class JobWorkerPoolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recommendFields: JobRecommendFieldsService,
    private readonly bidQueue: BidStatusQueueService,
  ) {}

  async setStatus(
    jobId: string,
    applierName: string,
    apiStatus: string,
    mutationId?: string,
  ) {
    const key = String(apiStatus || '').trim();
    if (key !== 'WorkerPool' && key !== 'clear') {
      throw new BadRequestException({
        success: false,
        error: 'status must be WorkerPool or clear',
        message: 'status must be WorkerPool or clear',
      });
    }
    return key === 'clear'
      ? this.clear(jobId, applierName, mutationId)
      : this.enqueue(jobId, applierName, mutationId);
  }

  async setStatusBulk(
    applierName: string,
    apiStatus: string,
    jobs: Array<{ id?: string }>,
    mutationId?: string,
  ) {
    const key = String(apiStatus || '').trim();
    if (key !== 'WorkerPool' && key !== 'clear') {
      throw new BadRequestException({
        success: false,
        error: 'status must be WorkerPool or clear',
        message: 'status must be WorkerPool or clear',
      });
    }

    const targets = normalizeBulkJobs(jobs);
    if (!targets.length) {
      throw new BadRequestException({
        success: false,
        error: 'jobs are required',
        message: 'jobs are required',
      });
    }

    const results: Array<{ jobId: string; viewerStatus: JobStatusState }> = [];
    const failed: Array<{ jobId: string; error: string }> = [];

    for (const jobId of targets) {
      try {
        const result =
          key === 'clear'
            ? await this.clear(jobId, applierName, mutationId)
            : await this.enqueue(jobId, applierName, mutationId);
        results.push({ jobId, viewerStatus: result.viewerStatus });
      } catch (err) {
        failed.push({
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      success: true as const,
      updatedCount: results.length,
      failed,
      results,
    };
  }

  private async enqueue(
    jobIdRaw: string,
    applierName: string,
    mutationId?: string,
  ): Promise<MutateResult> {
    const { profileId, job } = await this.requireJobAndProfile(
      jobIdRaw,
      applierName,
    );
    const existing = await this.prisma.jobStatus.findUnique({
      where: { profileId_jobId: { profileId, jobId: job.id } },
      select: { state: true, workerPoolAt: true },
    });
    const already = existing?.state === WORKER_POOL;
    const now = new Date();
    const workerPoolAt = existing?.workerPoolAt ?? now;

    if (!already) {
      await this.writeState(profileId, job.id, job.postedAt, workerPoolAt, now);
    }

    return {
      success: true,
      data: await this.jobDoc(job, profileId, WORKER_POOL),
      changed: !already,
      viewerStatus: WORKER_POOL,
      mutationId: mutationId?.trim() || null,
    };
  }

  private async clear(
    jobIdRaw: string,
    applierName: string,
    mutationId?: string,
  ): Promise<MutateResult> {
    const { profileId, job } = await this.requireJobAndProfile(
      jobIdRaw,
      applierName,
    );
    const { changed } = await this.bidQueue.clearBidReady({
      profileId,
      applierName: String(applierName).trim(),
      jobId: job.id,
    });
    return {
      success: true,
      data: await this.jobDoc(job, profileId, 'posted'),
      changed,
      viewerStatus: 'posted',
      mutationId: mutationId?.trim() || null,
    };
  }

  private async writeState(
    profileId: string,
    jobId: string,
    postedAt: Date,
    workerPoolAt: Date,
    now: Date,
  ) {
    const existing = await this.prisma.jobStatus.findUnique({
      where: { profileId_jobId: { profileId, jobId } },
      select: { id: true },
    });

    if (existing) {
      await withReplicaSetFallback(
        async () => {
          await this.prisma.jobStatus.update({
            where: { profileId_jobId: { profileId, jobId } },
            data: { state: WORKER_POOL, workerPoolAt, postedAt },
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
            {
              state: WORKER_POOL,
              workerPoolAt,
              postedAt,
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
            jobId,
            state: WORKER_POOL,
            workerPoolAt,
            postedAt,
          },
        });
      },
      () =>
        rawInsertOne(this.prisma, JOB_STATUSES_COLLECTION, {
          profileId: { $oid: profileId },
          jobId: { $oid: jobId },
          state: WORKER_POOL,
          workerPoolAt,
          postedAt,
          createdAt: now,
          updatedAt: now,
        }),
    );
  }

  private async jobDoc(
    job: Parameters<typeof mapJobToListDoc>[0],
    profileId: string,
    viewerStatus: JobStatusState,
  ): Promise<Record<string, unknown>> {
    const doc = mapJobToListDoc(job, viewerStatus);
    const recommendByJobId = await this.recommendFields.loadForProfile(
      profileId,
      [job.id],
    );
    const recommend =
      recommendByJobId.get(job.id) ||
      recommendByJobId.get(String(job.id).toLowerCase());
    return recommend ? { ...doc, ...recommend } : doc;
  }

  private async requireJobAndProfile(jobIdRaw: string, applierName: string) {
    const jobId = String(jobIdRaw || '').trim();
    if (!OBJECT_ID_RE.test(jobId)) {
      throw new BadRequestException({
        success: false,
        error: 'Invalid job id',
        message: 'Invalid job id',
      });
    }
    const name = String(applierName || '').trim();
    if (!name) {
      throw new BadRequestException({
        success: false,
        error: 'applierName is required',
        message: 'applierName is required',
      });
    }
    const account = await this.prisma.accountInfo.findUnique({
      where: { name },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException({
        success: false,
        error: `User ${name} not found`,
        message: `User ${name} not found`,
      });
    }
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException({
        success: false,
        error: 'Job not found',
        message: 'Job not found',
      });
    }
    return { profileId: account.id, job };
  }
}

function normalizeBulkJobs(jobs: Array<{ id?: string }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of Array.isArray(jobs) ? jobs : []) {
    const id = String(row?.id || '').trim();
    if (!OBJECT_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_BULK) break;
  }
  return out;
}
