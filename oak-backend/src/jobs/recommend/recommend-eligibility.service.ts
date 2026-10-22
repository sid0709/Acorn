import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LIBRARY_RECOMMEND_STATES } from '../constants/job-status-states.constants';

const INELIGIBLE_MESSAGE =
  'Recommend is only available for Bid ready or Worker pool jobs';

@Injectable()
export class RecommendEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  ineligibleMessage(): string {
    return INELIGIBLE_MESSAGE;
  }

  async eligibleJobIds(
    profileId: string,
    jobIds: string[],
  ): Promise<Set<string>> {
    const id = String(profileId || '').trim();
    const ids = [
      ...new Set(
        jobIds.map((jobId) => String(jobId || '').trim()).filter(Boolean),
      ),
    ];
    if (!id || !ids.length) return new Set();

    const rows = await this.prisma.jobStatus.findMany({
      where: {
        profileId: id,
        jobId: { in: ids },
        state: { in: [...LIBRARY_RECOMMEND_STATES] },
      },
      select: { jobId: true },
    });
    return new Set(rows.map((row) => row.jobId));
  }

  async isEligible(profileId: string, jobId: string): Promise<boolean> {
    const eligible = await this.eligibleJobIds(profileId, [jobId]);
    return eligible.has(String(jobId || '').trim());
  }
}
