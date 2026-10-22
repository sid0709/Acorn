import type { Prisma } from '@prisma/client';
import type { PostingCompanySort } from '../constants/posting-companies.constants';

const LEAN_PROJECT = {
  _id: 1,
  companyId: 1,
  companyName: 1,
  title: 1,
  postedAt: 1,
} as const;

export function postingCompaniesSort(
  sort: PostingCompanySort,
): Record<string, 1 | -1> {
  return sort === 'volume'
    ? { postingCount: -1, latestPostedAt: -1, sortId: 1 }
    : { latestPostedAt: -1, sortId: 1 };
}

export function postingCompaniesPagePipeline(
  match: Record<string, unknown> | null,
  sort: PostingCompanySort,
  cursorMatch: Record<string, unknown> | null,
  limit: number,
): Prisma.InputJsonValue[] {
  return [
    ...(match ? [{ $match: match }] : []),
    { $project: LEAN_PROJECT },
    { $sort: { postedAt: -1 } },
    {
      $group: {
        _id: { $ifNull: ['$companyId', '$companyName'] },
        companyName: { $first: '$companyName' },
        latestTitle: { $first: '$title' },
        latestPostedAt: { $first: '$postedAt' },
        postingCount: { $sum: 1 },
      },
    },
    { $match: { _id: { $nin: [null, ''] } } },
    { $addFields: { sortId: { $toString: '$_id' } } },
    ...(cursorMatch ? [{ $match: cursorMatch }] : []),
    { $sort: postingCompaniesSort(sort) },
    { $limit: limit },
  ] as Prisma.InputJsonValue[];
}

export function postingCompaniesTotalsPipeline(
  match: Record<string, unknown> | null,
): Prisma.InputJsonValue[] {
  return [
    ...(match ? [{ $match: match }] : []),
    { $project: { companyId: 1, companyName: 1 } },
    {
      $group: {
        _id: { $ifNull: ['$companyId', '$companyName'] },
        jobs: { $sum: 1 },
      },
    },
    { $match: { _id: { $nin: [null, ''] } } },
    {
      $group: {
        _id: null,
        companies: { $sum: 1 },
        jobs: { $sum: '$jobs' },
      },
    },
  ] as Prisma.InputJsonValue[];
}
