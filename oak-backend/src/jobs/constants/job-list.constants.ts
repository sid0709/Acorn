/** Application-status tabs on Job Search. */
export const JOB_STATUS_TABS = [
  'all',
  'posted',
  'bid-ready',
  'worker-pool',
  'bid-completed',
  'applied',
  'scheduled',
  'declined',
] as const;

export type JobStatusTab = (typeof JOB_STATUS_TABS)[number];

export const EMPTY_STATUS_COUNTS: Record<JobStatusTab, number> = {
  all: 0,
  posted: 0,
  'bid-ready': 0,
  'worker-pool': 0,
  'bid-completed': 0,
  applied: 0,
  scheduled: 0,
  declined: 0,
};

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

/** Initial nested jobs returned per company group on GET /jobs. */
export const COMPANY_MEMBERS_PAGE_SIZE = 10;
