import { Injectable } from '@nestjs/common';
import { parseSources } from '../jobs/lib/jobs-mongo-match';
import {
  extractFirstBatch,
  jobsAggregateCommand,
} from '../jobs/lib/jobs-list-pipelines';
import { asObjectIdHex } from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';
import {
  POSTING_COMPANIES_MAX_PAGE_SIZE,
  POSTING_COMPANIES_PAGE_SIZE,
  type PostingCompanySort,
} from './constants/posting-companies.constants';
import type { PostingCompaniesQueryDto } from './dto/posting-companies.query.dto';
import {
  decodePostingCompanyCursor,
  encodePostingCompanyCursor,
  postingCompanyCursorMatch,
} from './lib/posting-companies-cursor';
import {
  postingCompaniesPagePipeline,
  postingCompaniesTotalsPipeline,
} from './lib/posting-companies-pipeline';
import { parseReportsDateRange } from './lib/reports-date-range';
import { reportsJobMatch } from './lib/reports-job-match';
import {
  mapPostingCompanyRow,
  okPostingCompanies,
  type PostingCompanyAggRow,
} from './mappers/posting-companies.mapper';

type TotalsRow = { companies?: unknown; jobs?: unknown };

@Injectable()
export class ReportsPostingCompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PostingCompaniesQueryDto) {
    const sort: PostingCompanySort =
      query.sort === 'volume' ? 'volume' : 'recent';
    const limit = Math.min(
      Math.max(query.limit || POSTING_COMPANIES_PAGE_SIZE, 1),
      POSTING_COMPANIES_MAX_PAGE_SIZE,
    );
    const range = parseReportsDateRange(query.startDate, query.endDate);
    const match = reportsJobMatch(
      range,
      parseSources(query.scrapeSource),
      parseSources(query.source),
    );
    const cursor = decodePostingCompanyCursor(query.cursor, sort);
    const cursorMatch = postingCompanyCursorMatch(cursor);

    const [pageRaw, totalsRaw] = await Promise.all([
      this.prisma.$runCommandRaw(
        jobsAggregateCommand(
          postingCompaniesPagePipeline(match, sort, cursorMatch, limit + 1),
        ),
      ),
      this.prisma.$runCommandRaw(
        jobsAggregateCommand(postingCompaniesTotalsPipeline(match)),
      ),
    ]);

    const pageRows = extractFirstBatch(pageRaw) as PostingCompanyAggRow[];
    const hasMore = pageRows.length > limit;
    const visible = hasMore ? pageRows.slice(0, limit) : pageRows;
    const totalsRow = (extractFirstBatch(totalsRaw)[0] || {}) as TotalsRow;
    const logoById = await this.logosFor(visible);

    const data = visible
      .map((row) => mapPostingCompanyRow(row, logoById))
      .filter((row): row is NonNullable<typeof row> => row != null);

    const last = data[data.length - 1];
    const nextCursor =
      hasMore && last
        ? encodePostingCompanyCursor({
            sort,
            latestPostedAt: last.latestPostedAt,
            postingCount: last.postingCount,
            sortId: last.companyId,
          })
        : null;

    return okPostingCompanies(
      data,
      {
        companies: Number(totalsRow.companies) || 0,
        jobs: Number(totalsRow.jobs) || 0,
      },
      nextCursor,
    );
  }

  private async logosFor(
    rows: PostingCompanyAggRow[],
  ): Promise<Map<string, string | null>> {
    const ids = [
      ...new Set(
        rows
          .map((row) => asObjectIdHex(row._id))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const logos = new Map<string, string | null>();
    if (!ids.length) return logos;
    const companies = await this.prisma.company.findMany({
      where: { id: { in: ids } },
      select: { id: true, companyLogo: true },
    });
    for (const company of companies) {
      const logo =
        typeof company.companyLogo === 'string' && company.companyLogo.trim()
          ? company.companyLogo.trim()
          : null;
      logos.set(company.id, logo);
    }
    return logos;
  }
}
