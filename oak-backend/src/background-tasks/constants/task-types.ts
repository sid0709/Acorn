export const BACKGROUND_TASK_TYPES = {
  MAIL_AI_LABEL: 'mail_ai_label',
  RESUME_GENERATION: 'resume_generation',
  JOB_WORKER_POOL: 'job_worker_pool',
} as const;

export type BackgroundTaskType =
  (typeof BACKGROUND_TASK_TYPES)[keyof typeof BACKGROUND_TASK_TYPES];

export const BACKGROUND_TASK_STATUSES = {
  QUEUED: 'queued',
  RUNNING: 'running',
  CANCELLING: 'cancelling',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  COMPLETED_WITH_ERRORS: 'completed_with_errors',
  FAILED: 'failed',
} as const;

export type BackgroundTaskStatus =
  (typeof BACKGROUND_TASK_STATUSES)[keyof typeof BACKGROUND_TASK_STATUSES];

export const JOB_WORKER_POOL_MAX_IDS = 150;
export const RESUME_GENERATION_MAX_JOB_IDS = 12;

export const WORKER_HEARTBEAT_MS = 5_000;
export const WORKER_LEASE_MS = 60_000;
export const SSE_POLL_MS = 10_000;
export const SSE_HEARTBEAT_MS = 15_000;
export const WORKER_HEALTH_PROBE_TTL_MS = 5_000;

export type BackgroundWorkersMode = 'embedded' | 'worker' | 'off';

/** `off` = API only (split deploy). `worker` = claim loop, no public API duties. */
export function backgroundWorkersMode(
  env = process.env,
): BackgroundWorkersMode {
  const mode = String(env.BACKGROUND_WORKERS_MODE || 'embedded')
    .trim()
    .toLowerCase();
  if (mode === 'off' || mode === 'disabled' || mode === 'split') return 'off';
  if (mode === 'worker' || mode === 'split-worker') return 'worker';
  return 'embedded';
}
