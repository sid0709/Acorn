import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  rawUpdateMany,
  withReplicaSetFallback,
} from '../../prisma/mongo-standalone';
import { PrismaService } from '../../prisma/prisma.service';
import {
  JOB_REMOTE_REVIEW_STATUS,
  type JobRemoteValue,
} from '../constants/job-remote.constants';
import {
  TEMP_JOBS_COLLECTION,
  asInputJson,
  asMetaObject,
} from '../claim/claim-meta';
import { JOB_OBJECT_ID_PATTERN } from '../lib/normalize-job-ids';
import { normalizeJobDetails } from '../mappers/job-metadata.mapper';
import {
  mapRawRemoteReviewRow,
  readPendingRemoteReview,
  type RemoteReviewListItem,
} from './remote-review.mapper';

const JOBS_COLLECTION = 'jobs';

const PENDING_FILTER = {
  'metadata.remoteReview.status': JOB_REMOTE_REVIEW_STATUS.PENDING,
} as Prisma.InputJsonValue;

@Injectable()
export class RemoteReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async list(limit = 50): Promise<{
    success: true;
    pending: number;
    data: RemoteReviewListItem[];
  }> {
    const take = Math.max(1, Math.min(Number(limit) || 50, 100));
    const options = {
      projection: { _id: 1, title: 1, companyName: 1, metadata: 1 },
      sort: { 'metadata.remoteReview.analyzedAt': -1 },
      limit: take,
    } as Prisma.InputJsonValue;

    const [pending, catalogRaw, stagingRaw] = await Promise.all([
      this.pendingCount(),
      this.prisma.job.findRaw({ filter: PENDING_FILTER, options }),
      this.prisma.tempJob.findRaw({ filter: PENDING_FILTER, options }),
    ]);

    const seen = new Set<string>();
    const data: RemoteReviewListItem[] = [];
    for (const raw of [catalogRaw, stagingRaw]) {
      const rows = Array.isArray(raw) ? raw : [];
      for (const row of rows) {
        const item = mapRawRemoteReviewRow(row);
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        data.push(item);
        if (data.length >= take) break;
      }
      if (data.length >= take) break;
    }

    data.sort((a, b) =>
      String(b.analyzedAt ?? '').localeCompare(String(a.analyzedAt ?? '')),
    );
    return { success: true, pending, data: data.slice(0, take) };
  }

  async resolve(input: { id: string; remote: JobRemoteValue }): Promise<{
    success: true;
    id: string;
    remote: JobRemoteValue;
  }> {
    const id = String(input.id || '').trim();
    if (!JOB_OBJECT_ID_PATTERN.test(id)) {
      throw new BadRequestException({
        success: false,
        error: 'Invalid job id',
        message: 'Invalid job id',
      });
    }

    const catalog = await this.prisma.job.findUnique({
      where: { id },
      select: { metadata: true },
    });
    if (catalog) {
      await this.writeResolved(id, 'job', catalog.metadata, input.remote);
      return { success: true, id, remote: input.remote };
    }

    const staging = await this.prisma.tempJob.findUnique({
      where: { id },
      select: { metadata: true },
    });
    if (staging) {
      await this.writeResolved(id, 'tempJob', staging.metadata, input.remote);
      return { success: true, id, remote: input.remote };
    }

    throw new NotFoundException({
      success: false,
      error: 'Job not found',
      message: 'Job not found',
    });
  }

  private async pendingCount(): Promise<number> {
    const [catalog, staging] = await Promise.all([
      this.countPending(this.prisma.job),
      this.countPending(this.prisma.tempJob),
    ]);
    return catalog + staging;
  }

  private async countPending(model: {
    aggregateRaw: (args: {
      pipeline: Prisma.InputJsonValue[];
    }) => Promise<unknown>;
  }): Promise<number> {
    const raw = await model.aggregateRaw({
      pipeline: [
        { $match: PENDING_FILTER },
        { $count: 'total' },
      ] as Prisma.InputJsonValue[],
    });
    const rows: unknown[] = Array.isArray(raw) ? raw : [];
    const first: unknown = rows[0];
    if (!first || typeof first !== 'object' || Array.isArray(first)) return 0;
    const total = (first as { total?: unknown }).total;
    return typeof total === 'number' ? total : 0;
  }

  private async writeResolved(
    id: string,
    model: 'job' | 'tempJob',
    metadata: unknown,
    remote: JobRemoteValue,
  ): Promise<void> {
    const review = readPendingRemoteReview(asMetaObject(metadata).remoteReview);
    if (!review) {
      throw new BadRequestException({
        success: false,
        error: 'No pending remote review',
        message: 'This job does not need a remote-policy review.',
      });
    }

    const meta = asMetaObject(metadata);
    const details = normalizeJobDetails(meta.details) ?? {};
    details.remote = remote;
    meta.details = details;
    meta.remoteReview = {
      status: JOB_REMOTE_REVIEW_STATUS.RESOLVED,
      existing: review.existing,
      suggested: review.suggested,
      chosen: remote,
      confidence: review.confidence,
      resolvedAt: new Date().toISOString(),
      ...(review.reason ? { reason: review.reason } : {}),
    };

    const data = { metadata: asInputJson(meta) };
    const collection = model === 'job' ? JOBS_COLLECTION : TEMP_JOBS_COLLECTION;
    await withReplicaSetFallback(
      async () => {
        if (model === 'job') {
          await this.prisma.job.update({ where: { id }, data });
          return;
        }
        await this.prisma.tempJob.update({ where: { id }, data });
      },
      async () => {
        await rawUpdateMany(
          this.prisma,
          collection,
          { _id: { $oid: id } },
          { metadata: asInputJson(meta), updatedAt: new Date() },
        );
      },
    );
  }
}
