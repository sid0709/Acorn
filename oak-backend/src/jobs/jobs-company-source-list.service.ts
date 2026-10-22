import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { COMPANY_MEMBERS_PAGE_SIZE } from './constants/job-list.constants';
import type { ListJobsQueryDto } from './dto/list-jobs.query.dto';
import {
  companiesAggregateCommand,
  companiesSourcePagePipeline,
  companiesSourceTotalsPipeline,
  memberIdsFromMatchingBuckets,
  type SourceBucketPageRow,
} from './lib/company-source-list-pipelines';
import { extractFirstBatch } from './lib/jobs-list-pipelines';
import { parseSources } from './lib/jobs-mongo-match';
import type { CompanyGroupSource } from './mappers/company-group.mapper';
import { asObjectIdHex } from '../prisma/mongo-standalone';

export type SourceBucketListPage = {
  groups: CompanyGroupSource[];
  companyTotal: number;
  jobTotal: number;
};

type TotalsRow = { companies?: number; jobs?: number };

@Injectable()
export class JobsCompanySourceListService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Source-only All-tab page from denormalized company buckets.
   * Returns null when buckets are missing (pre-backfill) so callers fall back.
   */
  async tryList(
    query: ListJobsQueryDto,
    page: number,
    pageSize: number,
  ): Promise<SourceBucketListPage | null> {
    const sources = parseSources(query.source);
    if (!sources.length) return null;

    const sample = await this.prisma.company.findFirst({
      where: { sourceBuckets: { some: { source: { in: sources } } } },
      select: { id: true },
    });
    if (!sample) return null;

    const skip = (page - 1) * pageSize;
    const [pageRaw, totalsRaw] = await Promise.all([
      this.prisma.$runCommandRaw(
        companiesAggregateCommand(
          companiesSourcePagePipeline(sources, skip, pageSize),
        ),
      ),
      this.prisma.$runCommandRaw(
        companiesAggregateCommand(companiesSourceTotalsPipeline(sources)),
      ),
    ]);

    const totals = (extractFirstBatch(totalsRaw)[0] || {}) as TotalsRow;
    const pageRows = extractFirstBatch(pageRaw) as SourceBucketPageRow[];
    const groups = await this.groupsFromPageRows(pageRows);
    return {
      groups,
      companyTotal: Number(totals.companies || 0),
      jobTotal: Number(totals.jobs || 0),
    };
  }

  private async groupsFromPageRows(
    pageRows: SourceBucketPageRow[],
  ): Promise<CompanyGroupSource[]> {
    const candidateIds = [
      ...new Set(
        pageRows.flatMap((row) =>
          memberIdsFromMatchingBuckets(row.matchingBuckets, asObjectIdHex),
        ),
      ),
    ];
    const jobs =
      candidateIds.length === 0
        ? []
        : await this.prisma.job.findMany({
            where: { id: { in: candidateIds } },
            select: { id: true, postedAt: true },
          });
    const postedAtById = new Map(
      jobs.map((job) => [job.id, job.postedAt.getTime()]),
    );

    const groups: CompanyGroupSource[] = [];
    for (const row of pageRows) {
      const companyId = asObjectIdHex(row._id);
      if (!companyId) continue;
      const candidates = memberIdsFromMatchingBuckets(
        row.matchingBuckets,
        asObjectIdHex,
      );
      const matchingJobIds = candidates
        .filter((id) => postedAtById.has(id))
        .sort((a, b) => (postedAtById.get(b) || 0) - (postedAtById.get(a) || 0))
        .slice(0, COMPANY_MEMBERS_PAGE_SIZE);
      groups.push({
        companyId,
        companyName: String(row.companyName || 'Unknown'),
        companyLogo: row.companyLogo,
        companyUrl: row.companyUrl,
        matchingJobCount: Number(row.matchingCount || matchingJobIds.length),
        matchingJobIds,
      });
    }
    return groups;
  }
}
