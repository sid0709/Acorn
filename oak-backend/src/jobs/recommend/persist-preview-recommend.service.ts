import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RecommendEligibilityService } from './recommend-eligibility.service';
import { RecommendPersistService } from './recommend-persist.service';

@Injectable()
export class PersistPreviewRecommendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: RecommendEligibilityService,
    private readonly persist: RecommendPersistService,
  ) {}

  async persistPreview(input: {
    applierName: string;
    jobId: string;
    recommendedResumeStack: string;
    recommendedResumeReason?: string | null;
    warning?: string | null;
    mode?: 'llm' | 'heuristic';
    requestId?: string | null;
  }) {
    const applierName = String(input.applierName || '').trim();
    const jobId = String(input.jobId || '').trim();
    const stack = String(input.recommendedResumeStack || '').trim();
    if (!applierName || !jobId || !stack) {
      throw new BadRequestException({
        success: false,
        message: 'applierName, jobId, and recommendedResumeStack are required',
      });
    }

    const account = await this.prisma.accountInfo.findUnique({
      where: { name: applierName },
      select: { id: true, name: true },
    });
    if (!account) {
      throw new NotFoundException({
        success: false,
        message: `User ${applierName} not found`,
      });
    }

    if (!(await this.eligibility.isEligible(account.id, jobId))) {
      throw new BadRequestException({
        success: false,
        message: this.eligibility.ineligibleMessage(),
      });
    }

    const mode = input.mode === 'heuristic' ? 'heuristic' : 'llm';
    const doc = await this.persist.persist({
      applierName: account.name,
      profileId: account.id,
      jobId,
      recommendedResume: stack,
      matchedCatalogKey: stack,
      reason: input.recommendedResumeReason ?? `Matched ${stack}.`,
      useCustomizedResume: false,
      warning: input.warning ?? null,
      mode,
      requestId: input.requestId ?? null,
    });

    return {
      success: true as const,
      jobId,
      recommendedResumeStack: stack,
      recommendedResumeId: doc.recommendedResumeId ?? null,
      recommendedResumeReason: doc.recommendedResumeReason ?? null,
      useCustomizedResume: false,
      recommendWarning: doc.recommendWarning ?? null,
      recommendedAt:
        doc.recommendedAt?.toISOString() ?? new Date().toISOString(),
      recommendMode: mode,
    };
  }
}
