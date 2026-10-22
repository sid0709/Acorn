import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AccountInfoService } from '../auth/account-info.service';
import { PrismaService } from '../prisma/prisma.service';
import { scrapeSourceMatchClause } from '../jobs/lib/scrape-source-match';
import {
  REPORT_APPLIED_STATES,
  REPORT_EMPTY_SOURCE,
} from './constants/reports.constants';
import {
  mongoDateFieldMatch,
  parseReportsDateRange,
  type ParsedDateRange,
} from './lib/reports-date-range';
import type { DailyCountRow } from './mappers/reports-response.mapper';

type StatusAgg = {
  _id?: string | null;
  count?: number;
};

type StatusStateAgg = {
  _id?: { source?: string; state?: string } | null;
  count?: number;
};

@Injectable()
export class ReportsApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountInfoService,
  ) {}

  async dailyApplications(
    applierName?: string,
    startDate?: string,
    endDate?: string,
    scrapeSources: string[] = [],
  ): Promise<DailyCountRow[]> {
    const profileId = await this.resolveProfileId(applierName);
    if (!profileId) return [];

    const range = parseReportsDateRange(startDate, endDate);
    const match: Record<string, unknown> = {
      profileId: { $oid: profileId },
      state: { $in: [...REPORT_APPLIED_STATES] },
      ...this.activityDateMatch(range),
    };

    const pipeline: Record<string, unknown>[] = [
      { $match: match },
      ...this.jobLookupStages(scrapeSources, scrapeSources.length > 0),
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: { $ifNull: ['$updatedAt', '$createdAt'] },
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const rows = await this.aggregateStatuses(pipeline);
    return rows
      .map((row) => {
        const date = String(row._id || '').trim();
        const value = Number(row.count) || 0;
        if (!date || value <= 0) return null;
        return { date, value };
      })
      .filter((row): row is DailyCountRow => row != null);
  }

  /**
   * Application pipeline counts by job source for the applier,
   * dated by status `updatedAt` (fallback `createdAt`) within range.
   */
  async statusCountsBySource(
    applierName?: string,
    startDate?: string,
    endDate?: string,
    scrapeSources: string[] = [],
  ): Promise<{
    applied: Map<string, number>;
    scheduled: Map<string, number>;
    declined: Map<string, number>;
  }> {
    const empty = {
      applied: new Map<string, number>(),
      scheduled: new Map<string, number>(),
      declined: new Map<string, number>(),
    };
    const profileId = await this.resolveProfileId(applierName);
    if (!profileId) return empty;

    const range = parseReportsDateRange(startDate, endDate);
    const match: Record<string, unknown> = {
      profileId: { $oid: profileId },
      state: { $in: [...REPORT_APPLIED_STATES] },
      ...this.activityDateMatch(range),
    };

    const pipeline: Record<string, unknown>[] = [
      { $match: match },
      ...this.jobLookupStages(scrapeSources, true),
      {
        $group: {
          _id: {
            source: {
              $ifNull: ['$job.source', REPORT_EMPTY_SOURCE],
            },
            state: '$state',
          },
          count: { $sum: 1 },
        },
      },
    ];

    const raw = await this.prisma.jobStatus.aggregateRaw({
      pipeline: pipeline as Prisma.InputJsonValue[],
    });
    const rows = Array.isArray(raw) ? (raw as StatusStateAgg[]) : [];

    for (const row of rows) {
      const source =
        String(row._id?.source || '').trim() || REPORT_EMPTY_SOURCE;
      const state = String(row._id?.state || '').trim();
      const count = Number(row.count) || 0;
      if (count <= 0) continue;
      if (state === 'applied') empty.applied.set(source, count);
      else if (state === 'scheduled') empty.scheduled.set(source, count);
      else if (state === 'declined') empty.declined.set(source, count);
    }

    // "Applied" KPI includes all pipeline states (applied + scheduled + declined).
    for (const [source, count] of empty.scheduled) {
      empty.applied.set(source, (empty.applied.get(source) ?? 0) + count);
    }
    for (const [source, count] of empty.declined) {
      empty.applied.set(source, (empty.applied.get(source) ?? 0) + count);
    }

    return empty;
  }

  private jobLookupStages(
    scrapeSources: string[],
    required: boolean,
  ): Record<string, unknown>[] {
    if (!required) return [];
    const scrape = scrapeSourceMatchClause(scrapeSources, 'job.createdBy');
    return [
      {
        $lookup: {
          from: 'jobs',
          localField: 'jobId',
          foreignField: '_id',
          as: 'job',
        },
      },
      { $unwind: { path: '$job', preserveNullAndEmptyArrays: false } },
      ...(scrape ? [{ $match: scrape }] : []),
    ];
  }

  private activityDateMatch(range: ParsedDateRange): Record<string, unknown> {
    // Prefer updatedAt (last transition); fall back handled in $group date expr.
    const clause = mongoDateFieldMatch('updatedAt', range);
    return clause ?? {};
  }

  private async resolveProfileId(applierName?: string): Promise<string | null> {
    const name = String(applierName || '').trim();
    if (!name) return null;
    const account = await this.accounts.findByName(name);
    return account?.id ?? null;
  }

  private async aggregateStatuses(
    pipeline: Record<string, unknown>[],
  ): Promise<StatusAgg[]> {
    const raw = await this.prisma.jobStatus.aggregateRaw({
      pipeline: pipeline as Prisma.InputJsonValue[],
    });
    return Array.isArray(raw) ? (raw as StatusAgg[]) : [];
  }
}
