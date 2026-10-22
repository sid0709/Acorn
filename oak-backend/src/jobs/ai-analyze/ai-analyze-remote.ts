import {
  JOB_REMOTE_CONFIDENCE_MIN,
  JOB_REMOTE_REVIEW_STATUS,
  type JobRemoteValue,
} from '../constants/job-remote.constants';
import { canonicalizeJobRemote } from '../lib/canonicalize-job-remote';

export type RemoteReviewPending = {
  status: typeof JOB_REMOTE_REVIEW_STATUS.PENDING;
  existing: string;
  suggested: JobRemoteValue;
  confidence: number;
  analyzedAt: string;
  reason?: string;
};

export type RemoteFieldDecision = {
  remote?: string;
  review?: RemoteReviewPending;
};

function existingLabel(raw: string | undefined): string | undefined {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return undefined;
  return canonicalizeJobRemote(text) ?? text;
}

/**
 * High-confidence JD estimates fill an empty remote field.
 * They never overwrite a different existing value — that becomes a human review.
 * Low confidence leaves the stored remote unchanged.
 */
export function decideRemoteField(input: {
  existingRemote?: string;
  aiRemote?: string;
  aiConfidence?: number;
  aiReason?: string;
  analyzedAt: string;
}): RemoteFieldDecision {
  const existingRaw =
    typeof input.existingRemote === 'string' && input.existingRemote.trim()
      ? input.existingRemote.trim()
      : undefined;
  const existing = existingLabel(existingRaw);
  const suggested = canonicalizeJobRemote(input.aiRemote);
  const confidence =
    typeof input.aiConfidence === 'number' &&
    Number.isFinite(input.aiConfidence)
      ? input.aiConfidence
      : suggested
        ? 0.8
        : 0;
  const highConfidence =
    Boolean(suggested) && confidence >= JOB_REMOTE_CONFIDENCE_MIN;

  if (!highConfidence || !suggested) {
    return existingRaw ? { remote: existingRaw } : {};
  }

  if (!existing) {
    return { remote: suggested };
  }

  if (existing === suggested) {
    return { remote: suggested };
  }

  const reason =
    typeof input.aiReason === 'string' && input.aiReason.trim()
      ? input.aiReason.trim().slice(0, 240)
      : undefined;
  return {
    remote: existingRaw,
    review: {
      status: JOB_REMOTE_REVIEW_STATUS.PENDING,
      existing,
      suggested,
      confidence,
      analyzedAt: input.analyzedAt,
      ...(reason ? { reason } : {}),
    },
  };
}
