/** Shared helpers for temp_jobs claim / lease updates. */

import type { Prisma } from '@prisma/client';

export const TEMP_JOBS_COLLECTION = 'temp_jobs';

export type ClaimedTempJob = {
  id: string;
  title: string;
  companyName: string;
  description: string | null;
  applyLink: string | null;
  source: string;
  metadata: unknown;
  titleReviewLabel: string;
  aiSkillStatus: string | null;
};

type RawUpdateResult = {
  n?: number;
  nModified?: number;
  modifiedCount?: number;
};

export function modifiedCount(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 0;
  const r = raw as RawUpdateResult;
  if (typeof r.nModified === 'number') return r.nModified;
  if (typeof r.modifiedCount === 'number') return r.modifiedCount;
  if (typeof r.n === 'number') return r.n;
  return 0;
}

export function asObjectIdHex(value: unknown): string | null {
  if (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value))
    return value;
  if (value && typeof value === 'object' && '$oid' in value) {
    const oid = (value as { $oid?: unknown }).$oid;
    return typeof oid === 'string' && /^[a-fA-F0-9]{24}$/.test(oid)
      ? oid
      : null;
  }
  return null;
}

export function asMetaObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

/** Prisma $runCommandRaw JSON-safe metadata payload. */
export function asInputJson(
  value: Record<string, unknown>,
): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function isStaleClaimedAt(leaseRaw: unknown, staleMs: number): boolean {
  const lease = asMetaObject(leaseRaw);
  const claimedAt =
    typeof lease.claimedAt === 'string' ? Date.parse(lease.claimedAt) : NaN;
  if (!Number.isFinite(claimedAt)) return true;
  return Date.now() - claimedAt > staleMs;
}

export function leaseSessionId(capsuleRaw: unknown): string | null {
  const capsule = asMetaObject(capsuleRaw);
  const lease = asMetaObject(capsule.lease);
  return typeof lease.sessionId === 'string' ? lease.sessionId : null;
}
