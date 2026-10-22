import { Injectable } from '@nestjs/common';
import { BidReviewEventsService } from '../bids/bid-review-events.service';
import { VendorTaskService } from '../bids/vendor-task.service';
import {
  deleteManyWithFallback,
  mongoFieldIdIn,
  objectIdIn,
} from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyCatalogTotalService } from './company-catalog-total.service';
import { CompanyMembershipService } from './company-membership.service';
import { JobCatalogTotalService } from './job-catalog-total.service';
import { normalizeJobIds } from './lib/normalize-job-ids';

/** Must match `@@map` on Job / TempJob / JobStatus in prisma/schema.prisma. */
const JOBS_COLLECTION = 'jobs';
const TEMP_JOBS_COLLECTION = 'temp_jobs';
const JOB_STATUSES_COLLECTION = 'job_statuses';

export type HardDeleteResult = {
  success: true;
  deletedCount: number;
  deletedIds: string[];
  removedCount: number;
  removedIds: string[];
  alreadyAbsentCount: number;
};

/**
 * Permanent hard delete for catalog `jobs` and staging `temp_jobs`.
 * Also clears job_statuses, vendor_tasks, bid_review_events, and company membership.
 */
@Injectable()
export class JobHardDeleteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompanyMembershipService,
    private readonly jobTotals: JobCatalogTotalService,
    private readonly companyTotals: CompanyCatalogTotalService,
    private readonly vendorTasks: VendorTaskService,
    private readonly bidEvents: BidReviewEventsService,
  ) {}

  async deleteCatalogJobs(rawIds: unknown): Promise<HardDeleteResult> {
    const ids = normalizeJobIds(rawIds);
    if (!ids.length) {
      return emptyResult();
    }

    const existing = await this.prisma.job.findMany({
      where: { id: { in: ids } },
      select: { id: true, companyId: true, source: true },
    });
    const deletedIds = existing.map((row) => row.id);
    if (!deletedIds.length) {
      return {
        success: true,
        deletedCount: 0,
        deletedIds: [],
        removedCount: ids.length,
        removedIds: ids,
        alreadyAbsentCount: ids.length,
      };
    }

    await deleteManyWithFallback(
      this.prisma,
      JOB_STATUSES_COLLECTION,
      mongoFieldIdIn('jobId', deletedIds),
      () =>
        this.prisma.jobStatus.deleteMany({
          where: { jobId: { in: deletedIds } },
        }),
    );
    await this.vendorTasks.deleteByJobIds(deletedIds);
    await this.bidEvents.deleteByJobIds(deletedIds);
    await this.companies.detachJobs(existing);
    await deleteManyWithFallback(
      this.prisma,
      JOBS_COLLECTION,
      { _id: objectIdIn(deletedIds) },
      () => this.prisma.job.deleteMany({ where: { id: { in: deletedIds } } }),
    );

    this.jobTotals.invalidate();
    this.companyTotals.invalidate();

    return {
      success: true,
      deletedCount: deletedIds.length,
      deletedIds,
      removedCount: ids.length,
      removedIds: ids,
      alreadyAbsentCount: ids.length - deletedIds.length,
    };
  }

  async deleteTempJobs(rawIds: unknown): Promise<HardDeleteResult> {
    const ids = normalizeJobIds(rawIds);
    if (!ids.length) {
      return emptyResult();
    }

    const existing = await this.prisma.tempJob.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const deletedIds = existing.map((row) => row.id);
    if (!deletedIds.length) {
      return {
        success: true,
        deletedCount: 0,
        deletedIds: [],
        removedCount: ids.length,
        removedIds: ids,
        alreadyAbsentCount: ids.length,
      };
    }

    await deleteManyWithFallback(
      this.prisma,
      TEMP_JOBS_COLLECTION,
      { _id: objectIdIn(deletedIds) },
      () =>
        this.prisma.tempJob.deleteMany({ where: { id: { in: deletedIds } } }),
    );

    return {
      success: true,
      deletedCount: deletedIds.length,
      deletedIds,
      removedCount: ids.length,
      removedIds: ids,
      alreadyAbsentCount: ids.length - deletedIds.length,
    };
  }

  async deleteOtherCompanyJobs(input: {
    companyId: string;
    keepJobId: string;
  }): Promise<HardDeleteResult> {
    const companyId = String(input.companyId || '').trim();
    const keepJobId = String(input.keepJobId || '').trim();
    if (!companyId || !keepJobId) {
      return emptyResult();
    }

    const siblings = await this.prisma.job.findMany({
      where: { companyId },
      select: { id: true },
    });
    const siblingIds = siblings.map((row) => row.id);
    if (!siblingIds.includes(keepJobId)) {
      const err = new Error(
        'The active job no longer belongs to this company group',
      ) as Error & { code?: string; status?: number };
      err.code = 'COMPANY_GROUP_CHANGED';
      err.status = 409;
      throw err;
    }

    const toDelete = siblingIds.filter((id) => id !== keepJobId);
    return this.deleteCatalogJobs(toDelete);
  }
}

function emptyResult(): HardDeleteResult {
  return {
    success: true,
    deletedCount: 0,
    deletedIds: [],
    removedCount: 0,
    removedIds: [],
    alreadyAbsentCount: 0,
  };
}
