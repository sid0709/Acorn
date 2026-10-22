import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobStatusService } from './job-status.service';
import { mapJobToListDoc } from './mappers/job-list.mapper';
import { JobRecommendFieldsService } from './recommend/job-recommend-fields.service';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

@Injectable()
export class JobsDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobStatuses: JobStatusService,
    private readonly recommendFields: JobRecommendFieldsService,
  ) {}

  /** Full job document for View JD (includes description). */
  async getById(id: string, applierName = '', profileId = '') {
    const jobId = String(id || '').trim();
    if (!OBJECT_ID_RE.test(jobId)) {
      throw new BadRequestException({
        message: 'Invalid job id',
        error: 'Invalid job id',
      });
    }

    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException({
        message: 'Job not found',
        error: 'Job not found',
      });
    }

    const resolvedProfileId = await this.resolveProfileId(
      profileId,
      applierName,
    );
    let viewerStatus = 'posted';
    if (resolvedProfileId) {
      const states = await this.jobStatuses.statesForJobs(resolvedProfileId, [
        jobId,
      ]);
      viewerStatus = states.get(jobId) || 'posted';
    }

    const doc = mapJobToListDoc(job, viewerStatus);
    const recommendByJobId = applierName.trim()
      ? await this.recommendFields.loadForApplier(applierName.trim(), [jobId])
      : resolvedProfileId
        ? await this.recommendFields.loadForProfile(resolvedProfileId, [jobId])
        : new Map();
    const recommend =
      recommendByJobId.get(jobId) || recommendByJobId.get(jobId.toLowerCase());

    return {
      success: true as const,
      data: recommend ? { ...doc, ...recommend } : doc,
    };
  }

  private async resolveProfileId(
    profileId: string,
    applierName: string,
  ): Promise<string> {
    const fromQuery = String(profileId || '').trim();
    if (fromQuery) return fromQuery;

    const name = String(applierName || '').trim();
    if (!name) return '';

    const account = await this.prisma.accountInfo.findUnique({
      where: { name },
      select: { id: true },
    });
    return account?.id ?? '';
  }
}
