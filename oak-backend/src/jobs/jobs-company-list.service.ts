import { Injectable } from '@nestjs/common';
import { asObjectIdHex } from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';
import { COMPANY_MEMBERS_PAGE_SIZE } from './constants/job-list.constants';
import { JOB_LIST_SELECT } from './constants/job-list.select';
import type { ListJobsQueryDto } from './dto/list-jobs.query.dto';
import { JobsCompanySourceListService } from './jobs-company-source-list.service';
import {
  canListBySourceBuckets,
  buildJobsMongoMatch,
  type JobsIdConstraint,
} from './lib/jobs-mongo-match';
import {
  extractFirstBatch,
  jobsAggregateCommand,
  jobsFilteredPagePipeline,
  jobsFilteredTotalsPipeline,
  jobsMemberIdsPipeline,
  type FilteredCompanyPageRow,
} from './lib/jobs-list-pipelines';
import {
  mapCompanyGroupRow,
  type CompanyGroupSource,
} from './mappers/company-group.mapper';
import { JobStatusService } from './job-status.service';
import { JobRecommendFieldsService } from './recommend/job-recommend-fields.service';

type TotalsRow = { companies?: number; jobs?: number };

@Injectable()
export class JobsCompanyListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobStatuses: JobStatusService,
    private readonly recommendFields: JobRecommendFieldsService,
    private readonly sourceList: JobsCompanySourceListService,
  ) {}

  /** Unfiltered: page companies by lastPostedAt, hydrate first N jobIds. */
  async listUnfiltered(
    page: number,
    pageSize: number,
    profileId: string,
    applierName = '',
  ) {
    const companies = await this.prisma.company.findMany({
      orderBy: { lastPostedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const groups: CompanyGroupSource[] = companies.map((row) => ({
      companyId: row.id,
      companyName: row.companyName,
      companyLogo: row.companyLogo,
      companyUrl: row.companyUrl,
      matchingJobCount: row.jobCount,
      matchingJobIds: (row.jobIds || [])
        .slice(0, COMPANY_MEMBERS_PAGE_SIZE)
        .map((id) => asObjectIdHex(id))
        .filter((id): id is string => Boolean(id)),
    }));

    return this.hydrateGroups(groups, profileId, applierName);
  }

  /**
   * Filtered: aggregate matching jobs by companyId, page groups, hydrate.
   * Source-only All-tab uses company sourceBuckets when they exist.
   */
  async listFiltered(
    query: ListJobsQueryDto,
    page: number,
    pageSize: number,
    profileId: string,
    idConstraint: JobsIdConstraint = null,
    applierName = '',
  ) {
    if (
      idConstraint &&
      'includeIds' in idConstraint &&
      idConstraint.includeIds.length === 0
    ) {
      return {
        data: [] as Record<string, unknown>[],
        companyTotal: 0,
        jobTotal: 0,
      };
    }

    if (canListBySourceBuckets(query, idConstraint)) {
      const bucketed = await this.sourceList.tryList(query, page, pageSize);
      if (bucketed) {
        const data = await this.hydrateGroups(
          bucketed.groups,
          profileId,
          applierName,
        );
        return {
          data,
          companyTotal: bucketed.companyTotal,
          jobTotal: bucketed.jobTotal,
        };
      }
    }

    const match = buildJobsMongoMatch(query, idConstraint);
    const skip = (page - 1) * pageSize;
    const [pageRaw, totalsRaw] = await Promise.all([
      this.prisma.$runCommandRaw(
        jobsAggregateCommand(jobsFilteredPagePipeline(match, skip, pageSize)),
      ),
      this.prisma.$runCommandRaw(
        jobsAggregateCommand(jobsFilteredTotalsPipeline(match)),
      ),
    ]);

    const totals = (extractFirstBatch(totalsRaw)[0] || {}) as TotalsRow;
    const companyTotal = Number(totals.companies || 0);
    const jobTotal = Number(totals.jobs || 0);
    const pageRows = extractFirstBatch(pageRaw) as FilteredCompanyPageRow[];
    const companyIds = pageRows
      .map((row) => asObjectIdHex(row._id))
      .filter((id): id is string => Boolean(id));

    const [companyDocs, memberIdsByCompany] = await Promise.all([
      companyIds.length === 0
        ? Promise.resolve([])
        : this.prisma.company.findMany({
            where: { id: { in: companyIds } },
            select: {
              id: true,
              companyName: true,
              companyLogo: true,
              companyUrl: true,
            },
          }),
      this.memberIdsByCompany(companyIds, match),
    ]);
    const companyById = new Map(companyDocs.map((row) => [row.id, row]));

    const groups: CompanyGroupSource[] = [];
    for (const row of pageRows) {
      const companyId = asObjectIdHex(row._id);
      if (!companyId) continue;
      const company = companyById.get(companyId);
      const matchingJobIds = memberIdsByCompany.get(companyId) || [];
      groups.push({
        companyId,
        companyName: company?.companyName || 'Unknown',
        companyLogo: company?.companyLogo,
        companyUrl: company?.companyUrl,
        matchingJobCount: Number(row.matchingCount || matchingJobIds.length),
        matchingJobIds,
      });
    }

    const data = await this.hydrateGroups(groups, profileId, applierName);
    return { data, companyTotal, jobTotal };
  }

  private async memberIdsByCompany(
    companyIds: string[],
    match: Record<string, unknown>,
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (!companyIds.length) return out;
    const raw = await this.prisma.$runCommandRaw(
      jobsAggregateCommand(jobsMemberIdsPipeline(match, companyIds)),
    );
    for (const row of extractFirstBatch(raw)) {
      if (!row || typeof row !== 'object') continue;
      const doc = row as { _id?: unknown; matchingJobIds?: unknown[] };
      const companyId = asObjectIdHex(doc._id);
      if (!companyId) continue;
      out.set(
        companyId,
        (doc.matchingJobIds || [])
          .map((id) => asObjectIdHex(id))
          .filter((id): id is string => Boolean(id)),
      );
    }
    return out;
  }

  private async hydrateGroups(
    groups: CompanyGroupSource[],
    profileId: string,
    applierName = '',
  ): Promise<Record<string, unknown>[]> {
    const memberIds = [
      ...new Set(
        groups.flatMap((group) =>
          group.matchingJobIds
            .slice(0, COMPANY_MEMBERS_PAGE_SIZE)
            .map((id) => asObjectIdHex(id))
            .filter((id): id is string => Boolean(id)),
        ),
      ),
    ];

    const jobs =
      memberIds.length === 0
        ? []
        : await this.prisma.job.findMany({
            where: { id: { in: memberIds } },
            select: JOB_LIST_SELECT,
          });

    const stateByJobId = await this.jobStatuses.statesForJobs(
      profileId,
      memberIds,
    );

    const recommendByJobId = String(applierName || '').trim()
      ? await this.recommendFields.loadForApplier(applierName, memberIds)
      : await this.recommendFields.loadForProfile(profileId, memberIds);

    return groups.map((group) => {
      const row = mapCompanyGroupRow(group, jobs, stateByJobId);
      const jobsOut = Array.isArray(row.jobs) ? row.jobs : [];
      row.jobs = jobsOut.map((job) => {
        const id =
          asObjectIdHex((job as { _id?: unknown })._id) ||
          String((job as { _id?: string })._id || '');
        const recommend =
          recommendByJobId.get(id) || recommendByJobId.get(id.toLowerCase());
        if (!recommend) return job;
        return { ...job, ...recommend };
      });
      return row;
    });
  }
}
