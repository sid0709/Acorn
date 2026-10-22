import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ResumeGenerateEnqueueService } from '../../resumes/generator/resume-generate-enqueue.service';
import { cleanString } from '../../resumes/generator/lib/clean-string';
import { jobSkillNames } from '../../resumes/generator/lib/job-skill-names';
import type { OakPublicSession } from '../auth/oak-session.service';

@Injectable()
export class OakJobGenerateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enqueue: ResumeGenerateEnqueueService,
  ) {}

  /** Fill mode: enqueue from the stored Job.description (never re-analyze). */
  async enqueueForJob(session: OakPublicSession, jobIdRaw: string) {
    const jobId = cleanString(jobIdRaw);
    if (!jobId) {
      throw new BadRequestException({
        success: false,
        error: 'jobId is required',
      });
    }
    const account = await this.prisma.accountInfo.findUnique({
      where: { name: session.applierName },
      select: { id: true, name: true },
    });
    if (!account) {
      throw new NotFoundException({
        success: false,
        error: 'Account not found',
      });
    }
    const status = await this.prisma.jobStatus.findFirst({
      where: { profileId: account.id, jobId, state: 'worker-pool' },
      select: { jobId: true },
    });
    if (!status) {
      throw new NotFoundException({
        success: false,
        error: 'Worker-pool job not found',
      });
    }
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, description: true, aiSkills: true },
    });
    if (!job) {
      throw new NotFoundException({
        success: false,
        error: 'Worker-pool job not found',
      });
    }
    const jobDescription = cleanString(job.description);
    if (!jobDescription) {
      throw new BadRequestException({
        success: false,
        error: 'Job description is missing.',
      });
    }
    const queued = (await this.enqueue.enqueue({
      applierName: session.applierName,
      profileId: session.profileId,
      jobDescription,
      jobSkills: jobSkillNames(job.aiSkills),
      parentJobId: job.id,
    })) as { inputId?: unknown; task?: unknown };
    const inputId = cleanString(queued.inputId);
    if (!inputId) {
      throw new BadRequestException({
        success: false,
        error: 'Resume generation did not return an input id',
      });
    }
    return {
      ok: true as const,
      mode: 'fill' as const,
      jobId: job.id,
      inputId,
      jobDescription,
      task: queued.task ?? null,
    };
  }
}
