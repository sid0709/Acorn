import { Injectable } from '@nestjs/common';
import type { ListJobsQueryDto } from './dto/list-jobs.query.dto';
import {
  EMPTY_STATUS_COUNTS,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type JobStatusTab,
} from './constants/job-list.constants';
import { CompanyCatalogTotalService } from './company-catalog-total.service';
import { JobCatalogTotalService } from './job-catalog-total.service';
import { JobStatusService } from './job-status.service';
import { JobsCompanyListService } from './jobs-company-list.service';
import { applyListTotalToTabCounts } from './lib/apply-list-total-to-tab-counts';
import {
  hasAttributeFilters,
  type JobsIdConstraint,
} from './lib/jobs-mongo-match';

@Injectable()
export class JobsQueryService {
  constructor(
    private readonly catalogTotal: JobCatalogTotalService,
    private readonly companyCatalogTotal: CompanyCatalogTotalService,
    private readonly jobStatuses: JobStatusService,
    private readonly companyList: JobsCompanyListService,
  ) {}

  async list(query: ListJobsQueryDto) {
    const status = (query.status || 'all') as JobStatusTab;
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      PAGE_SIZE_MAX,
      Math.max(1, query.pageSize ?? PAGE_SIZE_DEFAULT),
    );
    const profileId = await this.jobStatuses.resolveProfileId(
      query.profileId || '',
      query.applierName || '',
    );
    const unfiltered = !hasAttributeFilters(query);
    const peekJobs = unfiltered ? (this.catalogTotal.peek() ?? 0) : 0;

    const idConstraint = await this.statusIdConstraint(status, profileId);
    if (
      idConstraint &&
      'includeIds' in idConstraint &&
      !idConstraint.includeIds.length
    ) {
      const tabCounts = await this.tabCountsForQuery(
        query,
        profileId,
        peekJobs,
        unfiltered,
      );
      return this.emptyPage(
        page,
        pageSize,
        applyListTotalToTabCounts(tabCounts, status, 0),
      );
    }

    const needsStatusFilter = status !== 'all';

    if (unfiltered && !needsStatusFilter) {
      const [companyTotal, jobTotal, data, tabCounts] = await Promise.all([
        this.companyCatalogTotal.getUnfiltered(),
        this.catalogTotal.getUnfiltered(),
        this.companyList.listUnfiltered(
          page,
          pageSize,
          profileId,
          query.applierName || '',
        ),
        this.jobStatuses.tabCounts(profileId, peekJobs),
      ]);
      return this.pageResult(
        data,
        page,
        pageSize,
        companyTotal,
        jobTotal,
        applyListTotalToTabCounts(tabCounts, status, jobTotal),
      );
    }

    const catalogForCounts = unfiltered
      ? await this.catalogTotal.getUnfiltered()
      : 0;

    const [filtered, tabCounts] = await Promise.all([
      this.companyList.listFiltered(
        query,
        page,
        pageSize,
        profileId,
        idConstraint,
        query.applierName || '',
      ),
      this.tabCountsForQuery(query, profileId, catalogForCounts, unfiltered),
    ]);

    return this.pageResult(
      filtered.data,
      page,
      pageSize,
      filtered.companyTotal,
      filtered.jobTotal,
      applyListTotalToTabCounts(tabCounts, status, filtered.jobTotal),
    );
  }

  private async tabCountsForQuery(
    query: ListJobsQueryDto,
    profileId: string,
    catalogTotal: number,
    unfiltered: boolean,
  ) {
    return unfiltered
      ? this.jobStatuses.tabCounts(profileId, catalogTotal)
      : this.jobStatuses.filteredTabCounts(profileId, query);
  }

  private async statusIdConstraint(
    status: JobStatusTab,
    profileId: string,
  ): Promise<JobsIdConstraint> {
    if (status === 'all') return null;
    if (!profileId) return { includeIds: [] };

    if (status === 'posted') {
      const excludeIds = await this.jobStatuses.jobIdsWithAnyStatus(profileId);
      return { excludeIds };
    }

    const includeIds = await this.jobStatuses.jobIdsForState(profileId, status);
    return { includeIds };
  }

  private pageResult(
    data: Record<string, unknown>[],
    page: number,
    pageSize: number,
    companyTotal: number,
    jobTotal: number,
    statusCounts: Record<JobStatusTab, number>,
  ) {
    const totalPages =
      companyTotal === 0 ? 0 : Math.ceil(companyTotal / pageSize);
    return {
      success: true as const,
      data,
      pagination: {
        total: companyTotal,
        totalJobs: jobTotal,
        unit: 'companies' as const,
        page,
        limit: pageSize,
        totalPages,
      },
      statusCounts,
      hasMore: page * pageSize < companyTotal,
      nextCursor: null,
    };
  }

  private emptyPage(
    page: number,
    pageSize: number,
    statusCounts: Record<JobStatusTab, number> = EMPTY_STATUS_COUNTS,
  ) {
    return this.pageResult([], page, pageSize, 0, 0, statusCounts);
  }
}
