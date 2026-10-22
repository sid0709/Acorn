import type { JobDetailsCapsule } from '../mappers/job-metadata.mapper';
import { normalizeJobDetails } from '../mappers/job-metadata.mapper';
import {
  decideRemoteField,
  type RemoteReviewPending,
} from './ai-analyze-remote';

export type MergedJobDetails = {
  details: JobDetailsCapsule;
  remoteReview?: RemoteReviewPending;
};

/**
 * Keep non-empty Extension/scrape-provided detail fields; fill gaps from AI.
 * Remote is the exception: high-confidence JD estimates fill empties and
 * queue a human review when they disagree with an existing value.
 */
export function mergeJobDetails(
  existingRaw: unknown,
  aiDetails: JobDetailsCapsule,
  remoteHint?: { confidence?: number; reason?: string },
): MergedJobDetails {
  const existing = normalizeJobDetails(existingRaw) ?? {};
  const next: JobDetailsCapsule = { ...existing };

  const keys: (keyof JobDetailsCapsule)[] = [
    'location',
    'time',
    'seniority',
    'salary',
  ];
  for (const key of keys) {
    const current = next[key];
    if (typeof current === 'string' && current.trim()) continue;
    const fromAi = aiDetails[key];
    if (typeof fromAi === 'string' && fromAi.trim()) {
      next[key] = fromAi.trim();
    }
  }

  const remote = decideRemoteField({
    existingRemote: existing.remote,
    aiRemote: aiDetails.remote,
    aiConfidence: remoteHint?.confidence,
    aiReason: remoteHint?.reason,
    analyzedAt: new Date().toISOString(),
  });
  if (remote.remote) next.remote = remote.remote;
  else delete next.remote;

  return {
    details: next,
    ...(remote.review ? { remoteReview: remote.review } : {}),
  };
}

export function asMetaRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}
