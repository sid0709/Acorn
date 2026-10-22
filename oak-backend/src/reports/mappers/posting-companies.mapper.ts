import { asObjectIdHex } from '../../prisma/mongo-standalone';

export type PostingCompanyRow = {
  companyId: string;
  companyName: string;
  companyLogo: string | null;
  latestTitle: string;
  latestPostedAt: string;
  postingCount: number;
};

export type PostingCompanyAggRow = {
  _id?: unknown;
  companyName?: unknown;
  latestTitle?: unknown;
  latestPostedAt?: unknown;
  postingCount?: unknown;
  sortId?: unknown;
};

export function asIsoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  }
  if (value && typeof value === 'object') {
    const rec = value as { $date?: unknown };
    if (typeof rec.$date === 'string') return rec.$date;
    if (typeof rec.$date === 'number') {
      const parsed = new Date(rec.$date);
      return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
    }
  }
  return '';
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

export function mapPostingCompanyRow(
  row: PostingCompanyAggRow,
  logoById: Map<string, string | null>,
): PostingCompanyRow | null {
  const companyId = asObjectIdHex(row._id) || asText(row.sortId);
  const companyName = asText(row.companyName) || 'Unknown';
  const latestTitle = asText(row.latestTitle);
  const latestPostedAt = asIsoDate(row.latestPostedAt);
  const postingCount = Number(row.postingCount) || 0;
  if (!companyId || postingCount <= 0 || !latestPostedAt) return null;
  const hex = asObjectIdHex(row._id);
  return {
    companyId,
    companyName,
    companyLogo: (hex && logoById.get(hex)) || null,
    latestTitle,
    latestPostedAt,
    postingCount,
  };
}

export function okPostingCompanies(
  data: PostingCompanyRow[],
  totals: { companies: number; jobs: number },
  nextCursor: string | null,
) {
  return { success: true as const, data, totals, nextCursor };
}
