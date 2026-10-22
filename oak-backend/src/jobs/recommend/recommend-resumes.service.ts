import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LlmAdmissionService } from '../../ai/concurrency/llm-admission.service';
import { RECOMMEND_RESUME_CONCURRENCY } from '../../ai/constants/ai-concurrency.constants';
import { mapPool } from '../../ai/concurrency/create-limiter';
import { MAX_RECOMMEND_JOBS } from '../../bids/constants/bid-status.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { ResumeLibraryCatalogService } from '../../resumes/resume-library-catalog.service';
import { VendorTaskService } from '../../bids/vendor-task.service';
import { hasStoredRecommendation } from './job-recommend-fields.mapper';
import { RecommendEligibilityService } from './recommend-eligibility.service';
import { RecommendOneService } from './recommend-one.service';
import { RecommendPersistService } from './recommend-persist.service';
import { normalizeRecommendJobIds } from './recommend-resumes.helpers';

@Injectable()
export class RecommendResumesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admission: LlmAdmissionService,
    private readonly persist: RecommendPersistService,
    private readonly eligibility: RecommendEligibilityService,
    private readonly libraryCatalog: ResumeLibraryCatalogService,
    private readonly vendorTasks: VendorTaskService,
    private readonly recommendOne: RecommendOneService,
  ) {}

  async recommendBulk(input: {
    applierName: string;
    jobIds: string[];
    replaceExisting?: boolean;
    persist?: boolean;
  }) {
    const name = String(input.applierName || '').trim();
    if (!name) {
      throw new BadRequestException({
        success: false,
        message: 'applierName is required',
      });
    }
    const account = await this.prisma.accountInfo.findUnique({
      where: { name },
      select: { id: true, name: true },
    });
    if (!account) {
      throw new NotFoundException({
        success: false,
        message: `User ${name} not found`,
      });
    }

    const jobIds = normalizeRecommendJobIds(input.jobIds, MAX_RECOMMEND_JOBS);
    if (!jobIds.length) {
      throw new BadRequestException({
        success: false,
        message: 'jobIds are required',
      });
    }

    const persist = input.persist !== false;
    const replaceExisting = input.replaceExisting !== false;
    const eligibleIds = persist
      ? await this.eligibility.eligibleJobIds(account.id, jobIds)
      : new Set(jobIds);

    const existingByJobId = new Map<
      string,
      Awaited<ReturnType<VendorTaskService['findByApplierJob']>>
    >();
    if (persist && !replaceExisting) {
      await Promise.all(
        jobIds.map(async (jobId) => {
          existingByJobId.set(
            jobId,
            await this.vendorTasks.findByApplierJob(account.name, jobId),
          );
        }),
      );
    }
    const needsLlm = (
      persist && !replaceExisting
        ? jobIds.filter((jobId) => {
            const existing = existingByJobId.get(jobId) ?? null;
            return !(existing && hasStoredRecommendation(existing));
          })
        : jobIds
    ).filter((jobId) => eligibleIds.has(jobId));
    const catalog =
      needsLlm.length > 0
        ? await this.libraryCatalog.compressForProfile(account.id)
        : { text: '', stackNames: [] as string[] };
    const results = await mapPool(
      jobIds,
      RECOMMEND_RESUME_CONCURRENCY,
      async (jobId) => {
        try {
          if (!eligibleIds.has(jobId)) {
            return {
              jobId,
              ok: false as const,
              skipped: false as const,
              error: this.eligibility.ineligibleMessage(),
            };
          }
          if (persist && !replaceExisting) {
            const existing = existingByJobId.get(jobId) ?? null;
            if (existing && hasStoredRecommendation(existing)) {
              return {
                jobId,
                ok: true as const,
                skipped: true as const,
                recommendedResumeStack:
                  existing?.recommendedResumeStack ?? null,
                recommendedResumeId: existing?.recommendedResumeId ?? null,
                recommendedResumeReason:
                  existing?.recommendedResumeReason ?? null,
                warning: existing?.recommendWarning ?? null,
                mode: 'skipped' as const,
                useCustomizedResume: Boolean(existing?.useCustomizedResume),
              };
            }
          }

          const outcome = await this.admission.run(account.id, () =>
            this.recommendOne.recommend(account.name, jobId, catalog),
          );
          const persisted = persist
            ? await this.persist.persist({
                applierName: account.name,
                profileId: account.id,
                jobId,
                ...outcome.result,
                mode: outcome.mode,
                usage: outcome.usage,
                requestId: outcome.requestId,
              })
            : null;
          return {
            jobId,
            ok: true as const,
            skipped: false as const,
            recommendedResumeStack:
              outcome.result.matchedCatalogKey ||
              outcome.result.recommendedResume,
            recommendedResumeId: persisted?.recommendedResumeId ?? null,
            recommendedResumeReason: outcome.result.reason,
            warning: outcome.result.warning,
            mode: outcome.mode,
            useCustomizedResume: outcome.result.useCustomizedResume,
          };
        } catch (err) {
          return {
            jobId,
            ok: false as const,
            skipped: false as const,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    );

    const succeeded = results.filter((r) => r.ok && !r.skipped).length;
    const skipped = results.filter((r) => r.ok && r.skipped).length;
    const failed = results.filter((r) => !r.ok).length;
    return {
      success: true as const,
      applierName: account.name,
      total: jobIds.length,
      succeeded,
      skipped,
      failed,
      replaceExisting,
      persist,
      results,
    };
  }
}
