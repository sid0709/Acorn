import {
  JOB_REMOTE_REVIEW_STATUS,
  JOB_REMOTE_VALUES,
  type JobRemoteValue,
} from '../constants/job-remote.constants';
import { canonicalizeJobRemote } from '../lib/canonicalize-job-remote';
import { asObjectIdHex } from '../lib/job-dedupe-raw';

export type RemoteReviewListItem = {
  id: string;
  title: string;
  companyName: string;
  existing: string;
  suggested: JobRemoteValue;
  confidence: number;
  reason?: string;
  analyzedAt?: string;
};

type RemoteReviewCapsule = {
  existing: string;
  suggested: JobRemoteValue;
  confidence: number;
  reason?: string;
  analyzedAt?: string;
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

export function readPendingRemoteReview(
  raw: unknown,
): RemoteReviewCapsule | null {
  const capsule = asRecord(raw);
  if (!capsule) return null;
  if (capsule.status !== JOB_REMOTE_REVIEW_STATUS.PENDING) return null;
  const suggested = canonicalizeJobRemote(capsule.suggested);
  if (!suggested || !JOB_REMOTE_VALUES.includes(suggested)) return null;
  const existing =
    typeof capsule.existing === 'string' && capsule.existing.trim()
      ? capsule.existing.trim()
      : suggested;
  const confidence = Number(capsule.confidence);
  const reason =
    typeof capsule.reason === 'string' && capsule.reason.trim()
      ? capsule.reason.trim()
      : undefined;
  const analyzedAt =
    typeof capsule.analyzedAt === 'string' && capsule.analyzedAt.trim()
      ? capsule.analyzedAt.trim()
      : undefined;
  return {
    existing,
    suggested,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    ...(reason ? { reason } : {}),
    ...(analyzedAt ? { analyzedAt } : {}),
  };
}

export function mapRawRemoteReviewRow(
  raw: unknown,
): RemoteReviewListItem | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asObjectIdHex(row._id) ?? asObjectIdHex(row.id);
  if (!id) return null;
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  const companyName =
    typeof row.companyName === 'string' ? row.companyName.trim() : '';
  if (!title) return null;
  const meta = asRecord(row.metadata);
  const review = readPendingRemoteReview(meta?.remoteReview);
  if (!review) return null;
  return {
    id,
    title,
    companyName,
    existing: review.existing,
    suggested: review.suggested,
    confidence: review.confidence,
    ...(review.reason ? { reason: review.reason } : {}),
    ...(review.analyzedAt ? { analyzedAt: review.analyzedAt } : {}),
  };
}
