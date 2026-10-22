/** Env-backed ingest / dedupe settings for temp_jobs → jobs. */

function envInt(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number.parseInt(String(process.env[name] ?? ''), 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(max, Math.floor(n));
}

function envText(name: string, fallback: string): string {
  const value = String(process.env[name] ?? '').trim();
  return value || fallback;
}

/** Rolling duplicate lookback for applyLink / company+title matches. Floor is 14 days. */
export const JOB_DEDUP_WINDOW_DAYS = envInt(
  'JOB_DEDUP_WINDOW_DAYS',
  14,
  14,
  365,
);

export function jobDedupCutoff(now = new Date()): Date {
  return new Date(now.getTime() - JOB_DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Schema stamp written on scrape ingest (`model_schema_code`).
 * Current promise: mongodb-athens-2026-08-06
 */
export const JOB_MODEL_SCHEMA_CODE = envText(
  'JOB_MODEL_SCHEMA_CODE',
  'mongodb-athens-2026-08-06',
);
