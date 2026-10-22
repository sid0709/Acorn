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
import {
  JOB_STATUS_STATES,
  type JobStatusState,
} from './constants/job-status-states.constants';
import { mapJobToListDoc } from './mappers/job-list.mapper';
import { JobRecommendFieldsService } from './recommend/job-recommend-fields.service';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const MAX_BULK = 150;
const JOB_STATUSES_COLLECTION = 'job_statuses';

const API_PIPELINE_STATUS: Record<string, JobStatusState> = {
  Applied: 'applied',
  Scheduled: 'scheduled',
  Declined: 'declined',
};

const API_BID_STATUS: Record<string, JobStatusState | null> = {
  BidReady: 'bid-ready',
  BidCompleted: 'bid-completed',
  clear: null,
};

type MutateResult = {
  success: true;
  data: Record<string, unknown>;
  changed: boolean;
  viewerStatus: JobStatusState;
  mutationId: string | null;
  message?: string;
};

@Injectable()
export class JobStatusMutateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bidQueue: BidStatusQueueService,
    private readonly recommendFields: JobRecommendFieldsService,
  ) {}

  async apply(jobId: string, applierName: string, mutationId?: string) {
    return this.setState(jobId, applierName, 'applied', mutationId, {
      alreadyMessage: 'User has already applied',
    });
  }

  async setPipelineStatus(
    jobId: string,
    applierName: string,
    apiStatus: string,
    mutationId?: string,
  ) {
    const state = API_PIPELINE_STATUS[String(apiStatus || '').trim()];
    if (!state) {
      throw new BadRequestException({
        success: false,
        error: 'Invalid status',
        message: 'Invalid status',
      });
    }
    return this.setState(jobId, applierName, state, mutationId);
  }

  async unapply(jobId: string, applierName: string, mutationId?: string) {
    return this.clearState(jobId, applierName, mutationId);
  }

  async setBidStatus(
    jobId: string,
    applierName: string,
    apiStatus: string,
    mutationId?: string,
  ) {
    const key = String(apiStatus || '').trim();
    if (!(key in API_BID_STATUS)) {
      throw new BadRequestException({
        success: false,
        error: 'status must be BidReady, BidCompleted, or clear',
        message: 'status must be BidReady, BidCompleted, or clear',
      });
    }
    const next = API_BID_STATUS[key];
    if (next == null) {
      return this.clearBidReady(jobId, applierName, mutationId);
    }
    return this.setBidPipeline(
      jobId,
      applierName,
      next as 'bid-ready' | 'bid-completed',
      mutationId,
    );
  }

  async setBidStatusBulk(
    applierName: string,
    apiStatus: string,
    jobs: Array<{ id?: string; catalog?: string }>,
    mutationId?: string,
  ) {
    const key = String(apiStatus || '').trim();
    if (key !== 'BidReady' && key !== 'clear') {
      throw new BadRequestException({
        success: false,
        error: 'status must be BidReady or clear',
        message: 'status must be BidReady or clear',
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
            ? await this.clearBidReady(jobId, applierName, mutationId)
            : await this.setBidPipeline(
                jobId,
                applierName,
                'bid-ready',
                mutationId,
              );
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

  async viewerStatus(jobId: string, applierName: string) {
    const { profileId, job } = await this.requireJobAndProfile(
      jobId,
      applierName,
    );
    const row = await this.prisma.jobStatus.findUnique({
      where: {
        profileId_jobId: { profileId, jobId: job.id },
      },
      select: { state: true },
    });
    const viewerStatus = normalizeState(row?.state) || 'posted';
    return {
      success: true as const,
      jobId: job.id,
      catalog: job.sourceCatalog === 'external' ? 'external' : 'market',
      viewerStatus,
      status: row ? [{ state: viewerStatus }] : [],
    };
  }

  private async setBidPipeline(
    jobIdRaw: string,
    applierName: string,
    state: 'bid-ready' | 'bid-completed',
    mutationId?: string,
  ): Promise<MutateResult> {
    const { profileId, job } = await this.requireJobAndProfile(
      jobIdRaw,
      applierName,
    );
    if (state === 'bid-ready') {
      const { changed } = await this.bidQueue.setBidReady({
        profileId,
        applierName: String(applierName).trim(),
        job,
      });
      return {
        success: true,
        data: await this.jobDocWithRecommend(job, profileId, 'bid-ready'),
        changed,
        viewerStatus: 'bid-ready',
        mutationId: mutationId?.trim() || null,
      };
    }
    await this.bidQueue.setBidCompleted({ profileId, job });
    return {
      success: true,
      data: await this.jobDocWithRecommend(job, profileId, 'bid-completed'),
      changed: true,
      viewerStatus: 'bid-completed',
      mutationId: mutationId?.trim() || null,
    };
  }

  private async setState(
    jobIdRaw: string,
    applierName: string,
    state: JobStatusState,
    mutationId?: string,
    opts?: { alreadyMessage?: string },
  ): Promise<MutateResult> {
    const { profileId, job } = await this.requireJobAndProfile(
      jobIdRaw,
      applierName,
    );

    const existing = await this.prisma.jobStatus.findUnique({
      where: {
        profileId_jobId: { profileId, jobId: job.id },
      },
      select: { state: true },
    });

    const previous = normalizeState(existing?.state);
    const changed = previous !== state;

    // Prefer Prisma; fall back to raw writes on standalone Mongo (no replica set).
    if (changed && existing) {
      await withReplicaSetFallback(
        async () => {
          await this.prisma.jobStatus.update({
            where: {
              profileId_jobId: { profileId, jobId: job.id },
            },
            data: { state },
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
            { state, updatedAt: new Date() },
          );
        },
      );
    } else if (changed) {
      const now = new Date();
      await withReplicaSetFallback(
        async () => {
          await this.prisma.jobStatus.create({
            data: { profileId, jobId: job.id, state },
          });
        },
        () =>
          rawInsertOne(this.prisma, JOB_STATUSES_COLLECTION, {
            profileId: { $oid: profileId },
            jobId: { $oid: job.id },
            state,
            createdAt: now,
            updatedAt: now,
          }),
      );
    }

    if (state === 'applied') {
      await this.recommendFields.persistAppliedSnapshots(profileId, [job.id]);
    }

    return {
      success: true,
      data: await this.jobDocWithRecommend(job, profileId, state),
      changed,
      viewerStatus: state,
      mutationId: mutationId?.trim() || null,
      ...(!changed && opts?.alreadyMessage
        ? { message: opts.alreadyMessage }
        : {}),
    };
  }

  private async clearBidReady(
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
      data: await this.jobDocWithRecommend(job, profileId, 'posted'),
      changed,
      viewerStatus: 'posted',
      mutationId: mutationId?.trim() || null,
    };
  }

  private async clearState(
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
      data: await this.jobDocWithRecommend(job, profileId, 'posted'),
      changed,
      viewerStatus: 'posted',
      mutationId: mutationId?.trim() || null,
    };
  }

  /** List-shaped job doc plus vendor_tasks / job_statuses recommend fields. */
  private async jobDocWithRecommend(
    job: Parameters<typeof mapJobToListDoc>[0],
    profileId: string,
    viewerStatus: string,
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

function normalizeState(raw: string | null | undefined): JobStatusState | null {
  const state = String(raw || '').trim();
  if ((JOB_STATUS_STATES as readonly string[]).includes(state)) {
    return state as JobStatusState;
  }
  return null;
}

function normalizeBulkJobs(
  jobs: Array<{ id?: string; catalog?: string }>,
): string[] {
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
