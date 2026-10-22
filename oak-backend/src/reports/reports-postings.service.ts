import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { REPORT_EMPTY_SOURCE } from './constants/reports.constants';
import { reportsJobMatch } from './lib/reports-job-match';
import { parseReportsDateRange } from './lib/reports-date-range';
import { mapDailySourceAndScrapeRows } from './mappers/reports-daily-source-scrape.mapper';
import type {
  DailyPostingBySourceAndScrapeRow,
  DailyPostingBySourceRow,
  JobSourceSummaryRow,
} from './mappers/reports-response.mapper';

type AggBucket = {
  _id?: { date?: string; source?: string } | string | null;
  count?: number;
  source?: string;
};

@Injectable()
export class ReportsPostingsService {
  constructor(private readonly prisma: PrismaService) {}

  async dailyBySource(
    startDate?: string,
    endDate?: string,
    scrapeSources: string[] = [],
  ): Promise<DailyPostingBySourceRow[]> {
    const range = parseReportsDateRange(startDate, endDate);
    const match = reportsJobMatch(range, scrapeSources);
    const pipeline: Record<string, unknown>[] = [
      ...(match ? [{ $match: match }] : []),
      {
        $group: {
          _id: {
            date: {
              $dateToString: { format: '%Y-%m-%d', date: '$postedAt' },
            },
            source: { $ifNull: ['$source', REPORT_EMPTY_SOURCE] },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.date': 1, '_id.source': 1 } },
    ];

    const rows = await this.aggregateJobs(pipeline);
    return rows
      .map((row) => {
        const id = row._id;
        if (!id || typeof id !== 'object') return null;
        const date = String(id.date || '').trim();
        const source = String(id.source || '').trim() || REPORT_EMPTY_SOURCE;
        const count = Number(row.count) || 0;
        if (!date || count <= 0) return null;
        return { date, source, count };
      })
      .filter((row): row is DailyPostingBySourceRow => row != null);
  }

  async dailyBySourceAndScrape(
    startDate?: string,
    endDate?: string,
    scrapeSources: string[] = [],
    sources: string[] = [],
  ): Promise<DailyPostingBySourceAndScrapeRow[]> {
    const range = parseReportsDateRange(startDate, endDate);
    const match = reportsJobMatch(range, scrapeSources, sources);
    const pipeline: Record<string, unknown>[] = [
      ...(match ? [{ $match: match }] : []),
      {
        $group: {
          _id: {
            date: {
              $dateToString: { format: '%Y-%m-%d', date: '$postedAt' },
            },
            source: { $ifNull: ['$source', REPORT_EMPTY_SOURCE] },
            scrapeSource: { $ifNull: ['$createdBy', REPORT_EMPTY_SOURCE] },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.date': 1, '_id.source': 1, '_id.scrapeSource': 1 } },
    ];

    return mapDailySourceAndScrapeRows(await this.aggregateJobs(pipeline));
  }

  /** Posting totals per source for the date range (postedAt). */
  async postingsBySource(
    startDate?: string,
    endDate?: string,
    scrapeSources: string[] = [],
  ): Promise<Map<string, number>> {
    const range = parseReportsDateRange(startDate, endDate);
    const match = reportsJobMatch(range, scrapeSources);
    const pipeline: Record<string, unknown>[] = [
      ...(match ? [{ $match: match }] : []),
      {
        $group: {
          _id: { $ifNull: ['$source', REPORT_EMPTY_SOURCE] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ];

    const rows = await this.aggregateJobs(pipeline);
    const out = new Map<string, number>();
    for (const row of rows) {
      const source = String(row._id ?? '').trim() || REPORT_EMPTY_SOURCE;
      const count = Number(row.count) || 0;
      if (count > 0) out.set(source, count);
    }
    return out;
  }

  mergeSourceSummary(
    postings: Map<string, number>,
    applied: Map<string, number>,
    scheduled: Map<string, number>,
    declined: Map<string, number>,
  ): JobSourceSummaryRow[] {
    const sources = new Set<string>([
      ...postings.keys(),
      ...applied.keys(),
      ...scheduled.keys(),
      ...declined.keys(),
    ]);
    return [...sources]
      .map((source) => ({
        source,
        postings: postings.get(source) ?? 0,
        applied: applied.get(source) ?? 0,
        scheduled: scheduled.get(source) ?? 0,
        declined: declined.get(source) ?? 0,
      }))
      .filter(
        (row) =>
          row.postings > 0 ||
          row.applied > 0 ||
          row.scheduled > 0 ||
          row.declined > 0,
      )
      .sort(
        (a, b) => b.postings - a.postings || a.source.localeCompare(b.source),
      );
  }

  private async aggregateJobs(
    pipeline: Record<string, unknown>[],
  ): Promise<AggBucket[]> {
    const raw = await this.prisma.job.aggregateRaw({
      pipeline: pipeline as Prisma.InputJsonValue[],
    });
    return Array.isArray(raw) ? (raw as AggBucket[]) : [];
  }
}
