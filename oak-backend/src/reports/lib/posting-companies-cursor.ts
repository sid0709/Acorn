import { toMongoDate } from '../../prisma/mongo-standalone';
import type { PostingCompanySort } from '../constants/posting-companies.constants';

export type PostingCompanyCursor = {
  sort: PostingCompanySort;
  latestPostedAt: string;
  postingCount: number;
  sortId: string;
};

export function encodePostingCompanyCursor(
  cursor: PostingCompanyCursor,
): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodePostingCompanyCursor(
  raw: string | undefined,
  sort: PostingCompanySort,
): PostingCompanyCursor | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<PostingCompanyCursor>;
    const latestPostedAt = String(parsed.latestPostedAt || '').trim();
    const sortId = String(parsed.sortId || '').trim();
    const postingCount = Number(parsed.postingCount);
    if (
      parsed.sort !== sort ||
      !latestPostedAt ||
      !sortId ||
      !Number.isFinite(postingCount)
    ) {
      return null;
    }
    return {
      sort,
      latestPostedAt,
      postingCount,
      sortId,
    };
  } catch {
    return null;
  }
}

export function postingCompanyCursorMatch(
  cursor: PostingCompanyCursor | null,
): Record<string, unknown> | null {
  if (!cursor) return null;
  const date = toMongoDate(cursor.latestPostedAt);
  if (!date) return null;
  if (cursor.sort === 'recent') {
    return {
      $or: [
        { latestPostedAt: { $lt: date } },
        { latestPostedAt: date, sortId: { $gt: cursor.sortId } },
      ],
    };
  }
  return {
    $or: [
      { postingCount: { $lt: cursor.postingCount } },
      {
        postingCount: cursor.postingCount,
        latestPostedAt: { $lt: date },
      },
      {
        postingCount: cursor.postingCount,
        latestPostedAt: date,
        sortId: { $gt: cursor.sortId },
      },
    ],
  };
}
