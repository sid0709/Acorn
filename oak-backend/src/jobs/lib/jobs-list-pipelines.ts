import type { Prisma } from '@prisma/client';
import { COMPANY_MEMBERS_PAGE_SIZE } from '../constants/job-list.constants';

/** Fields needed to group / page Job Search — never pull description. */
export const JOB_LIST_LEAN_PROJECT = {
  _id: 1,
  companyId: 1,
  postedAt: 1,
} as const;

export type FilteredCompanyPageRow = {
  _id?: unknown;
  matchingCount?: number;
};

export function extractFirstBatch(raw: unknown): unknown[] {
  if (!raw || typeof raw !== 'object') return [];
  const doc = raw as {
    cursor?: { firstBatch?: unknown[] };
    firstBatch?: unknown[];
  };
  if (Array.isArray(doc.cursor?.firstBatch)) return doc.cursor.firstBatch;
  if (Array.isArray(doc.firstBatch)) return doc.firstBatch;
  return [];
}

export function jobsAggregateCommand(
  pipeline: Prisma.InputJsonValue[],
  collection = 'jobs',
): Prisma.InputJsonObject {
  return {
    aggregate: collection,
    pipeline,
    cursor: {},
    allowDiskUse: true,
  };
}

export function jobsFilteredPagePipeline(
  match: Record<string, unknown>,
  skip: number,
  pageSize: number,
): Prisma.InputJsonValue[] {
  return [
    { $match: match },
    { $project: JOB_LIST_LEAN_PROJECT },
    {
      $group: {
        _id: '$companyId',
        lastPostedAt: { $max: '$postedAt' },
        matchingCount: { $sum: 1 },
      },
    },
    { $sort: { lastPostedAt: -1 } },
    { $skip: skip },
    { $limit: pageSize },
  ] as Prisma.InputJsonValue[];
}

export function jobsFilteredTotalsPipeline(
  match: Record<string, unknown>,
): Prisma.InputJsonValue[] {
  return [
    { $match: match },
    { $project: JOB_LIST_LEAN_PROJECT },
    {
      $group: {
        _id: '$companyId',
        matchingCount: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: null,
        companies: { $sum: 1 },
        jobs: { $sum: '$matchingCount' },
      },
    },
  ] as Prisma.InputJsonValue[];
}

export function jobsMemberIdsPipeline(
  match: Record<string, unknown>,
  companyIds: string[],
): Prisma.InputJsonValue[] {
  return [
    {
      $match: {
        ...match,
        companyId: { $in: companyIds.map((id) => ({ $oid: id })) },
      },
    },
    { $project: JOB_LIST_LEAN_PROJECT },
    { $sort: { postedAt: -1 } },
    {
      $setWindowFields: {
        partitionBy: '$companyId',
        sortBy: { postedAt: -1 },
        output: { memberRank: { $documentNumber: {} } },
      },
    },
    { $match: { memberRank: { $lte: COMPANY_MEMBERS_PAGE_SIZE } } },
    {
      $group: {
        _id: '$companyId',
        matchingJobIds: { $push: '$_id' },
      },
    },
  ] as Prisma.InputJsonValue[];
}

export function jobsMatchingIdsPipeline(
  match: Record<string, unknown>,
): Prisma.InputJsonValue[] {
  return [
    { $match: match },
    { $project: { _id: 1 } },
  ] as Prisma.InputJsonValue[];
}

/** Job count for the same `$match` the company-grouped list uses. */
export function jobsFilteredCountPipeline(
  match: Record<string, unknown>,
): Prisma.InputJsonValue[] {
  return [{ $match: match }, { $count: 'jobs' }] as Prisma.InputJsonValue[];
}
