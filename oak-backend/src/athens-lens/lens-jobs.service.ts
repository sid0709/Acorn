import { Injectable } from '@nestjs/common';
import { BidStatusQueueService } from '../bids/bid-status-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { mapAthensLensJob } from './mappers/athens-lens-job.mapper';

@Injectable()
export class LensJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bidQueue: BidStatusQueueService,
  ) {}

  async list(applierName: string, limit = 100) {
    const account = await this.prisma.accountInfo.findUnique({
      where: { name: applierName },
      select: { id: true, name: true },
    });
    if (!account) {
      return { success: true as const, jobs: [], total: 0 };
    }

    const bounded = Math.min(Math.max(1, limit), 200);
    const statuses = await this.bidQueue.listQueue(account.id, {
      includeCompleted: false,
      limit: bounded,
    });

    const jobIds = statuses.map((s) => s.jobId);
    const jobs = await this.prisma.job.findMany({
      where: { id: { in: jobIds } },
    });
    const jobById = new Map(jobs.map((j) => [j.id, j]));

    const tasks = await this.prisma.vendorTask.findMany({
      where: { applierName: account.name, jobId: { in: jobIds } },
      select: {
        jobId: true,
        status: true,
        recommendedResumeStack: true,
        recommendedResumeReason: true,
        useCustomizedResume: true,
        recommendWarning: true,
        recommendedAt: true,
      },
    });
    const skippedJobIds = new Set(
      tasks.filter((t) => t.status === 'skipped').map((t) => String(t.jobId)),
    );
    const recommendByJob = new Map(tasks.map((t) => [t.jobId, t]));

    const mapped = [];
    for (const status of statuses) {
      const job = jobById.get(status.jobId);
      if (!job) continue;
      if (
        skippedJobIds.has(String(status.jobId)) ||
        skippedJobIds.has(String(job.id))
      ) {
        continue;
      }
      const recommend = recommendByJob.get(status.jobId);
      mapped.push(mapAthensLensJob(job, status, recommend));
    }

    return {
      success: true as const,
      jobs: mapped,
      total: mapped.length,
    };
  }
}
