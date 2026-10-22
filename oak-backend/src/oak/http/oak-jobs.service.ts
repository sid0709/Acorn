import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JobRecommendFieldsService } from '../../jobs/recommend/job-recommend-fields.service';
import { AgentJobResumesService } from '../../resumes/agent-job-resumes.service';
import { mapOakWorkerJob } from './mappers/oak-job.mapper';

const LIST_LIMIT_MAX = 200;

@Injectable()
export class OakJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recommendFields: JobRecommendFieldsService,
    private readonly agentResumes: AgentJobResumesService,
  ) {}

  async list(applierName: string, limit = 100) {
    const account = await this.prisma.accountInfo.findUnique({
      where: { name: applierName },
      select: { id: true, name: true },
    });
    if (!account) {
      return { success: true as const, jobs: [], total: 0 };
    }

    const bounded = Math.min(Math.max(1, limit), LIST_LIMIT_MAX);
    const statuses = await this.prisma.jobStatus.findMany({
      where: { profileId: account.id, state: 'worker-pool' },
      orderBy: [{ workerPoolAt: 'desc' }, { postedAt: 'desc' }],
      take: bounded,
      select: { jobId: true, workerPoolAt: true },
    });

    const jobIds = statuses.map((row) => row.jobId);
    if (!jobIds.length) {
      return { success: true as const, jobs: [], total: 0 };
    }

    const jobs = await this.prisma.job.findMany({
      where: { id: { in: jobIds } },
      select: {
        id: true,
        title: true,
        companyName: true,
        applyLink: true,
        description: true,
        metadata: true,
      },
    });
    const jobById = new Map(jobs.map((job) => [job.id, job]));

    const [recommendByJob, generated] = await Promise.all([
      this.recommendFields.loadForApplier(account.name, jobIds),
      this.agentResumes.status(account.name, jobIds),
    ]);
    const generatedIds = new Set(generated.jobIds);

    const mapped = [];
    for (const status of statuses) {
      const job = jobById.get(status.jobId);
      if (!job) continue;
      const recommend =
        recommendByJob.get(status.jobId) ||
        recommendByJob.get(status.jobId.toLowerCase());
      mapped.push(
        mapOakWorkerJob(
          job,
          status,
          recommend ?? null,
          generatedIds.has(status.jobId),
        ),
      );
    }

    return {
      success: true as const,
      jobs: mapped,
      total: mapped.length,
    };
  }

  async getOne(applierName: string, jobId: string) {
    const account = await this.prisma.accountInfo.findUnique({
      where: { name: applierName },
      select: { id: true, name: true },
    });
    if (!account) {
      throw new NotFoundException({
        success: false,
        error: 'Worker-pool job not found',
      });
    }
    const status = await this.prisma.jobStatus.findFirst({
      where: { profileId: account.id, jobId, state: 'worker-pool' },
      select: { jobId: true, workerPoolAt: true },
    });
    if (!status) {
      throw new NotFoundException({
        success: false,
        error: 'Worker-pool job not found',
      });
    }
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        title: true,
        companyName: true,
        applyLink: true,
        description: true,
        metadata: true,
      },
    });
    if (!job) {
      throw new NotFoundException({
        success: false,
        error: 'Worker-pool job not found',
      });
    }
    const [recommendByJob, generated] = await Promise.all([
      this.recommendFields.loadForApplier(account.name, [jobId]),
      this.agentResumes.status(account.name, [jobId]),
    ]);
    const recommend =
      recommendByJob.get(jobId) || recommendByJob.get(jobId.toLowerCase());
    return {
      success: true as const,
      job: mapOakWorkerJob(
        job,
        status,
        recommend ?? null,
        generated.jobIds.includes(jobId),
      ),
    };
  }
}
