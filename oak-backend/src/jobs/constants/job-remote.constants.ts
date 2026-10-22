/** Canonical work-mode labels stored on `metadata.details.remote`. */
export const JOB_REMOTE_VALUES = ['Remote', 'Hybrid', 'On-site'] as const;

export type JobRemoteValue = (typeof JOB_REMOTE_VALUES)[number];

/**
 * Apply or queue a remote estimate only at or above this score.
 * Below it, leave `metadata.details.remote` unchanged.
 */
export const JOB_REMOTE_CONFIDENCE_MIN = 0.7;

export const JOB_REMOTE_REVIEW_STATUS = {
  PENDING: 'pending',
  RESOLVED: 'resolved',
} as const;

export type JobRemoteReviewStatus =
  (typeof JOB_REMOTE_REVIEW_STATUS)[keyof typeof JOB_REMOTE_REVIEW_STATUS];
