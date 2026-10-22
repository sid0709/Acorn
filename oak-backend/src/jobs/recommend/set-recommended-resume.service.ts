import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BidReviewEventsService } from '../../bids/bid-review-events.service';
import { matchUploadToRecommended } from '../../bids/lib/resume-catalog';
import { VendorTaskService } from '../../bids/vendor-task.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ResumeService } from '../../resumes/resume.service';
import { RecommendEligibilityService } from './recommend-eligibility.service';

@Injectable()
export class SetRecommendedResumeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resumes: ResumeService,
    private readonly vendorTasks: VendorTaskService,
    private readonly events: BidReviewEventsService,
    private readonly eligibility: RecommendEligibilityService,
  ) {}

  async setManual(input: {
    applierName: string;
    jobId: string;
    resumeId: string;
  }) {
    const applierName = String(input.applierName || '').trim();
    const jobId = String(input.jobId || '').trim();
    const resumeId = String(input.resumeId || '').trim();
    if (!applierName || !jobId || !resumeId) {
      throw new BadRequestException({
        success: false,
        message: 'applierName, jobId, and resumeId are required',
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

    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true },
    });
    if (!job) {
      throw new NotFoundException({
        success: false,
        message: 'Job not found',
      });
    }

    if (!(await this.eligibility.isEligible(account.id, jobId))) {
      throw new BadRequestException({
        success: false,
        message: this.eligibility.ineligibleMessage(),
      });
    }

    const resume = await this.resumes.findOwned(resumeId, account.name);
    const stack = String(resume.title || '').trim();
    if (!stack) {
      throw new BadRequestException({
        success: false,
        message: 'Library resume has no stack label (title)',
      });
    }

    const existing = await this.vendorTasks.findByApplierJob(
      account.name,
      jobId,
    );
    const resumeStackMatch = matchUploadToRecommended(
      existing?.resumeOriginalName,
      stack,
    );
    const reason = 'Manually selected from Library.';

    const doc = await this.vendorTasks.upsertFields(account.name, jobId, {
      recommendedResumeStack: stack,
      recommendedResumeId: resume.id,
      recommendedResumeReason: reason,
      useCustomizedResume: false,
      recommendWarning: null,
      recommendedAt: new Date(),
      recommendMode: 'manual',
      recommendRequestId: null,
      resumeStackMatch,
    });

    await this.events.append({
      applierName: account.name,
      jobId,
      vendorTaskId: doc.id,
      eventType: 'recommend_resume',
      feature: 'bid-recommend-resume-manual',
      meta: {
        recommendedResumeStack: stack,
        recommendedResumeId: resume.id,
        useCustomizedResume: false,
        mode: 'manual',
      },
    });

    return {
      success: true as const,
      jobId,
      recommendedResumeStack: stack,
      recommendedResumeId: resume.id,
      recommendedResumeReason: reason,
      useCustomizedResume: false,
      recommendWarning: null as string | null,
      recommendedAt:
        doc.recommendedAt?.toISOString() ?? new Date().toISOString(),
      recommendMode: 'manual' as const,
      resumeStackMatch,
    };
  }
}
