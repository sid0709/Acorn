import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toMongoDate } from '../prisma/mongo-standalone';
import {
  ALL_MAIL_PATH,
  MAIL_PAGE_SIZE_MAX,
  MAIL_STATS_EXCLUDED_FOLDERS,
  MAIL_STATS_MAX_LABELS,
} from './constants/mail.constants';
import { MailCredentialsService } from './mail-credentials.service';
import { MailSyncService } from './mail-sync.service';
import { messageToThread } from './mappers/mail-thread.mapper';

const EXCLUDED = [...MAIL_STATS_EXCLUDED_FOLDERS];

type StatsInput = {
  applierName: string;
  from?: string;
  to?: string;
  labels: string[];
  page: number;
  pageSize: number;
};

type FacetCount = { n?: number };
type FacetLabel = { _id?: string; count?: number };
type FacetDoc = {
  total?: FacetCount[];
  unlabeled?: FacetCount[];
  byLabel?: FacetLabel[];
};

/**
 * Live mailbox stats: labels-only IMAP scan for counts, envelopes for the
 * visible page. Mongo is the fallback cache if Gmail is unreachable.
 */
@Injectable()
export class MailStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: MailCredentialsService,
    private readonly sync: MailSyncService,
  ) {}

  async list(input: {
    applierName: string;
    from?: string;
    to?: string;
    label?: string[];
    page?: number;
    pageSize?: number;
  }) {
    const creds = await this.credentials.resolve(input.applierName);
    if (!creds.ok) throw new BadRequestException(creds.error);
    if (!this.credentials.isBeta(creds.tier)) {
      throw new ForbiddenException(
        'Beta access required for this mail feature.',
      );
    }

    const page = Math.max(1, Math.floor(input.page || 1));
    const pageSize = Math.min(
      MAIL_PAGE_SIZE_MAX,
      Math.max(1, Math.floor(input.pageSize || 25)),
    );
    const labels = (input.label || [])
      .map((label) => String(label || '').trim())
      .filter(Boolean)
      .slice(0, MAIL_STATS_MAX_LABELS);
    const from = parseIso(input.from);
    const to = parseIso(input.to);
    if (input.from && !from) {
      throw new BadRequestException('from must be an ISO date');
    }
    if (input.to && !to) {
      throw new BadRequestException('to must be an ISO date');
    }

    const query: StatsInput = {
      applierName: creds.applierName,
      from: from?.toISOString(),
      to: to?.toISOString(),
      labels,
      page,
      pageSize,
    };

    try {
      const live = await this.sync.loadStatsPage(creds, {
        since: from,
        before: to ? imapExclusiveBefore(to) : undefined,
        selected: labels,
        page,
        pageSize,
        force: false,
      });
      return {
        success: true,
        total: live.total,
        unlabeled: live.unlabeled,
        labeled: live.labeled,
        byLabel: live.byLabel,
        threads: live.messages.map((row) =>
          messageToThread(row, { includeBody: false }),
        ),
        page,
        pageSize,
        hasMore: page * pageSize < live.total,
      };
    } catch {
      /* fall back to cache */
    }

    const [counts, rows] = await Promise.all([
      this.aggregateCounts(query),
      this.prisma.mailMessage.findMany({
        where: prismaWhere(query),
        orderBy: { date: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      success: true,
      total: counts.total,
      unlabeled: counts.unlabeled,
      labeled: counts.labeled,
      byLabel: counts.byLabel,
      threads: rows.map((row) => messageToThread(row, { includeBody: false })),
      page,
      pageSize,
      hasMore: page * pageSize < counts.total,
    };
  }

  private async aggregateCounts(query: StatsInput) {
    const match = mongoMatch(query);
    const byLabel: Record<string, unknown>[] = [{ $unwind: '$labels' }];
    if (query.labels.length) {
      byLabel.push({ $match: { labels: { $in: query.labels } } });
    }
    byLabel.push(
      { $group: { _id: '$labels', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    );

    const facet: Record<string, unknown> = {
      total: [{ $count: 'n' }],
      byLabel,
    };
    if (!query.labels.length) {
      facet.unlabeled = [{ $match: { labels: { $size: 0 } } }, { $count: 'n' }];
    }

    const raw = await this.prisma.mailMessage.aggregateRaw({
      pipeline: [
        { $match: match },
        { $facet: facet },
      ] as Prisma.InputJsonValue[],
    });
    const doc = (Array.isArray(raw) ? raw[0] : raw) as FacetDoc | null;
    const total = facetCount(doc?.total);
    const unlabeled = query.labels.length ? 0 : facetCount(doc?.unlabeled);
    const labeled = Math.max(0, total - unlabeled);
    const byLabelRows = Array.isArray(doc?.byLabel) ? doc.byLabel : [];
    return {
      total,
      unlabeled,
      labeled,
      byLabel: byLabelRows
        .map((row) => ({
          label: String(row._id || '').trim(),
          count: Number(row.count) || 0,
        }))
        .filter((row) => row.label && row.count > 0),
    };
  }
}

function parseIso(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** IMAP BEFORE is a date-only exclusive bound, so move to the next local day. */
function imapExclusiveBefore(to: Date): Date {
  return new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
}

function prismaWhere(query: StatsInput): Prisma.MailMessageWhereInput {
  const date =
    query.from || query.to
      ? {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        }
      : undefined;
  return {
    applierName: query.applierName,
    mailbox: ALL_MAIL_PATH,
    folder: { notIn: EXCLUDED },
    ...(date ? { date } : {}),
    ...(query.labels.length ? { labels: { hasSome: query.labels } } : {}),
  };
}

function mongoMatch(query: StatsInput): Record<string, unknown> {
  const match: Record<string, unknown> = {
    applierName: query.applierName,
    mailbox: ALL_MAIL_PATH,
    folder: { $nin: EXCLUDED },
  };
  if (query.from || query.to) {
    const date: Record<string, unknown> = {};
    const gte = query.from ? toMongoDate(query.from) : null;
    const lte = query.to ? toMongoDate(query.to) : null;
    if (gte) date.$gte = gte;
    if (lte) date.$lte = lte;
    match.date = date;
  }
  if (query.labels.length) match.labels = { $in: query.labels };
  return match;
}

function facetCount(rows: FacetCount[] | undefined): number {
  return Number(rows?.[0]?.n) || 0;
}
