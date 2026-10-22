import type { Prisma } from '@prisma/client';
import { COMPANY_MEMBERS_PAGE_SIZE } from '../constants/job-list.constants';
import { jobsAggregateCommand } from './jobs-list-pipelines';

export type SourceBucketPageRow = {
  _id?: unknown;
  companyName?: string;
  companyLogo?: string | null;
  companyUrl?: string | null;
  matchingCount?: number;
  matchingBuckets?: Array<{
    source?: string;
    jobIds?: unknown[];
    count?: number;
  }>;
};

export function companiesSourcePagePipeline(
  sources: string[],
  skip: number,
  pageSize: number,
): Prisma.InputJsonValue[] {
  return [
    ...companiesSourceMatchPipeline(sources),
    { $sort: { lastPostedAt: -1 } },
    { $skip: skip },
    { $limit: pageSize },
    {
      $project: {
        _id: 1,
        companyName: 1,
        companyLogo: 1,
        companyUrl: 1,
        matchingCount: 1,
        matchingBuckets: 1,
      },
    },
  ] as Prisma.InputJsonValue[];
}

export function companiesSourceTotalsPipeline(
  sources: string[],
): Prisma.InputJsonValue[] {
  return [
    ...companiesSourceMatchPipeline(sources),
    {
      $group: {
        _id: null,
        companies: { $sum: 1 },
        jobs: { $sum: '$matchingCount' },
      },
    },
  ] as Prisma.InputJsonValue[];
}

export function companiesAggregateCommand(
  pipeline: Prisma.InputJsonValue[],
): Prisma.InputJsonObject {
  return jobsAggregateCommand(pipeline, 'companies');
}

function companiesSourceMatchPipeline(
  sources: string[],
): Prisma.InputJsonValue[] {
  return [
    { $match: { 'sourceBuckets.source': { $in: sources } } },
    {
      $addFields: {
        matchingBuckets: {
          $filter: {
            input: { $ifNull: ['$sourceBuckets', []] },
            as: 'bucket',
            cond: { $in: ['$$bucket.source', sources] },
          },
        },
      },
    },
    {
      $addFields: {
        lastPostedAt: { $max: '$matchingBuckets.lastPostedAt' },
        matchingCount: { $sum: '$matchingBuckets.count' },
      },
    },
  ] as Prisma.InputJsonValue[];
}

/** First N ids from each selected bucket (enough for a newest-first merge). */
export function memberIdsFromMatchingBuckets(
  buckets: Array<{ jobIds?: unknown[] }> | undefined,
  asObjectIdHex: (value: unknown) => string | null,
): string[] {
  const ids: string[] = [];
  for (const bucket of buckets || []) {
    const slice = (bucket.jobIds || []).slice(0, COMPANY_MEMBERS_PAGE_SIZE);
    for (const id of slice) {
      const hex = asObjectIdHex(id);
      if (hex) ids.push(hex);
    }
  }
  return [...new Set(ids)];
}
