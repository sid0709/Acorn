/** vendor_tasks.status */
export const VENDOR_TASK_STATUSES = ['pending', 'done', 'skipped'] as const;
export type VendorTaskStatus = (typeof VENDOR_TASK_STATUSES)[number];

/** vendor_tasks.reviewStatus */
export const REVIEW_STATUSES = ['submitted', 'reviewed', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Bid Management UI status (derived) */
export const BID_UI_STATUSES = [
  'pending',
  'in_process',
  'submitted',
  'reviewed',
  'rejected',
  'skipped',
] as const;
export type BidUiStatus = (typeof BID_UI_STATUSES)[number];

export const BID_RECORDINGS_PREFIX = 'bid-recordings/';
export const BID_RESULT_ID_PREFIX = 'bid-';
export const SKIP_REASON_MAX_LENGTH = 2000;

export const MAX_RECOMMEND_JOBS = 40;
export const BID_QUEUE_LIMIT = 1000;
export const REJECTED_LIST_LIMIT = 500;
export const RECORDING_URL_EXPIRES_MS = 60 * 60_000;
export const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60_000;
export const DEFAULT_MAX_RECORDING_BYTES = 8 * 1024 * 1024 * 1024;
