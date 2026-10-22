import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  JOB_STATUS_STATES,
  type JobStatusState,
} from './constants/job-status-states.constants';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const MAX_POSTED = 500;
const TRACKED_STATES = JOB_STATUS_STATES.filter(
  (state): state is Exclude<JobStatusState, 'posted'> => state !== 'posted',
);

@Injectable()
export class JobCompanyPostedService {
  constructor(private readonly prisma: PrismaService) {}

  async postedIds(input: {
    applierName: string;
    companyId: string;
    keepJobId?: string;
  }) {
    const applierName = String(input.applierName || '').trim();
    if (!applierName) {
      throw new BadRequestException({
        success: false,
        error: 'applierName is required',
      });
    }

    const account = await this.prisma.accountInfo.findUnique({
      where: { name: applierName },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException({
        success: false,
        error: `User ${applierName} not found`,
      });
    }

    const companyId = await this.resolveCompanyId(
      input.companyId,
      input.keepJobId,
    );
    const jobs = await this.prisma.job.findMany({
      where: { companyId, NOT: { sourceCatalog: 'external' } },
      select: { id: true, postedAt: true },
      orderBy: { postedAt: 'desc' },
      take: MAX_POSTED,
    });
    if (!jobs.length) {
      return { success: true as const, companyId, jobIds: [] as string[] };
    }

    const tracked = await this.prisma.jobStatus.findMany({
      where: {
        profileId: account.id,
        jobId: { in: jobs.map((job) => job.id) },
        state: { in: [...TRACKED_STATES] },
      },
      select: { jobId: true },
    });
    const trackedIds = new Set(tracked.map((row) => row.jobId));
    const jobIds = jobs
      .map((job) => job.id)
      .filter((id) => !trackedIds.has(id));

    return { success: true as const, companyId, jobIds };
  }

  private async resolveCompanyId(
    raw: string,
    keepJobId?: string,
  ): Promise<string> {
    const companyId = String(raw || '').trim();
    if (OBJECT_ID_RE.test(companyId)) return companyId;
    const keepId = String(keepJobId || '').trim();
    if (!OBJECT_ID_RE.test(keepId)) {
      throw new BadRequestException({
        success: false,
        error: 'Invalid company id',
      });
    }
    const job = await this.prisma.job.findUnique({
      where: { id: keepId },
      select: { companyId: true },
    });
    const resolved = String(job?.companyId || '').trim();
    if (!OBJECT_ID_RE.test(resolved)) {
      throw new BadRequestException({
        success: false,
        error: 'Invalid company id',
      });
    }
    return resolved;
  }
}
