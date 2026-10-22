import { asObjectIdHex } from '../../../prisma/mongo-standalone';
import { normalizeCompanyKey } from '../../lib/company-key';

export type CompanyBlockJobHit = {
  id: string;
  title: string;
  companyName: string;
  source: string;
  postedAt: string | null;
  applyLink: string | null;
  collection: 'jobs' | 'temp_jobs';
};

function asObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function postedAtIso(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const wrapped = asObject(value);
  if (wrapped && typeof wrapped.$date === 'string') {
    const parsed = new Date(wrapped.$date);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

export function mapRawBlockJob(
  raw: unknown,
  companyKey: string,
  collection: CompanyBlockJobHit['collection'],
): CompanyBlockJobHit | null {
  const row = asObject(raw);
  if (!row) return null;
  const companyName = asText(row.companyName);
  if (normalizeCompanyKey(companyName) !== companyKey) return null;
  const id = asObjectIdHex(row._id);
  if (!id) return null;
  return {
    id,
    title: asText(row.title),
    companyName,
    source: asText(row.source),
    postedAt: postedAtIso(row.postedAt),
    applyLink: asText(row.applyLink) || null,
    collection,
  };
}

export function mapCatalogBlockJob(
  row: {
    id: string;
    title: string;
    companyName: string;
    source: string;
    postedAt: Date;
    applyLink: string | null;
  },
  collection: CompanyBlockJobHit['collection'],
): CompanyBlockJobHit {
  return {
    id: row.id,
    title: row.title,
    companyName: row.companyName,
    source: row.source,
    postedAt: row.postedAt.toISOString(),
    applyLink: row.applyLink,
    collection,
  };
}
