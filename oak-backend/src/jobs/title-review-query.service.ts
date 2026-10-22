import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  TITLE_REVIEW_META_STATES,
  type TitleReviewMetaState,
} from './constants/job-pipeline.constants';
import type { ListTitleReviewQueryDto } from './dto/list-title-review.query.dto';
import { mapJobToTitleReviewRow } from './mappers/title-review.mapper';
import { TempJobQueueService } from './temp-job-queue.service';

/** Title Review operates on `temp_jobs` only. */
const TITLE_REVIEW_JOB_SELECT = {
  id: true,
  title: true,
  companyName: true,
  source: true,
  postedAt: true,
  applyLink: true,
  titleReviewLabel: true,
  metadata: true,
} as const satisfies Prisma.TempJobSelect;

function tabToState(tab: string): TitleReviewMetaState {
  if (tab === 'review_required')
    return TITLE_REVIEW_META_STATES.REVIEW_REQUIRED;
  if (tab === 'failed') return TITLE_REVIEW_META_STATES.FAILED;
  return TITLE_REVIEW_META_STATES.PENDING;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleReviewSort(sort: string): Record<string, 1 | -1> {
  if (sort === 'confidence_asc') {
    return { 'metadata.titleReview.confidence': 1, postedAt: -1 };
  }
  if (sort === 'confidence_desc') {
    return { 'metadata.titleReview.confidence': -1, postedAt: -1 };
  }
  return { postedAt: sort === 'oldest' ? 1 : -1 };
}

function asObjectIdHex(value: unknown): string | null {
  if (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value))
    return value;
  if (value && typeof value === 'object' && '$oid' in value) {
    const oidRaw = (value as { $oid?: unknown }).$oid;
    const oid = typeof oidRaw === 'string' ? oidRaw : '';
    return /^[a-fA-F0-9]{24}$/.test(oid) ? oid : null;
  }
  return null;
}

@Injectable()
export class TitleReviewQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: TempJobQueueService,
  ) {}

  async list(query: ListTitleReviewQueryDto) {
    const started = Date.now();
    const tab = String(query.tab || 'unreviewed').trim();
    const state = tabToState(tab);
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(500, Math.max(1, query.limit ?? 50));
    const q = String(query.q ?? '').trim();
    const sort = String(query.sort || 'newest').trim();

    const match: Record<string, unknown> = {
      ...this.queues.titleReviewMongoMatch(state),
    };
    if (q) {
      match.title = { $regex: escapeRegex(q), $options: 'i' };
    }

    const [counts, total, idRows] = await Promise.all([
      this.queues.titleReviewCounts(),
      this.queues.countByMatch(match),
      this.prisma.tempJob.findRaw({
        filter: match as Prisma.InputJsonValue,
        options: {
          projection: { _id: 1 },
          sort: titleReviewSort(sort),
          skip: (page - 1) * limit,
          limit,
        },
      }),
    ]);

    const jobIds = (Array.isArray(idRows) ? idRows : [])
      .map((row) => asObjectIdHex((row as { _id?: unknown })._id))
      .filter((id): id is string => Boolean(id));

    if (!jobIds.length) {
      return {
        success: true as const,
        data: [] as ReturnType<typeof mapJobToTitleReviewRow>[],
        counts,
        pagination: { page, limit, total, totalPages: 0 },
        meta: {
          cacheSource: 'memory' as const,
          revision:
            total === 0 ? 'temp-jobs:empty' : `temp-jobs:${state}:${total}`,
          stale: false,
          serverDurationMs: Date.now() - started,
          returnedRows: 0,
        },
      };
    }

    const rows = await this.prisma.tempJob.findMany({
      where: { id: { in: jobIds } },
      select: TITLE_REVIEW_JOB_SELECT,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = jobIds
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return {
      success: true as const,
      data: ordered.map((row) => mapJobToTitleReviewRow(row, state)),
      counts,
      pagination: { page, limit, total, totalPages },
      meta: {
        cacheSource: 'memory' as const,
        revision: `temp-jobs:${state}:${total}`,
        stale: false,
        serverDurationMs: Date.now() - started,
        returnedRows: ordered.length,
      },
    };
  }
}
