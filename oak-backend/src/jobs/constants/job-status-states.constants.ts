/** Per-job application states stored on `job_statuses.state`. */
export const JOB_STATUS_STATES = [
  'posted',
  'bid-ready',
  'worker-pool',
  'bid-completed',
  'applied',
  'scheduled',
  'declined',
] as const;

export type JobStatusState = (typeof JOB_STATUS_STATES)[number];

/** Library resume recommend / assign is only for Oak + Lens queues. */
export const LIBRARY_RECOMMEND_STATES = [
  'bid-ready',
  'worker-pool',
] as const satisfies readonly JobStatusState[];
