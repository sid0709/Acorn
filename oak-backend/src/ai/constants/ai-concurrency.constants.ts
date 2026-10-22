/** Env-backed concurrency / batch knobs for the AI process layer. */

function envInt(name: string, fallback: number, min = 1, max = 256): number {
  const n = Number.parseInt(String(process.env[name] ?? ''), 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(max, Math.floor(n));
}

export const LLM_GLOBAL_CONCURRENCY = envInt('LLM_GLOBAL_CONCURRENCY', 48);
export const LLM_PER_USER_CONCURRENCY = envInt('LLM_PER_USER_CONCURRENCY', 16);

export const TITLE_REVIEW_BATCH_SIZE = envInt(
  'JOB_TITLE_REVIEW_BATCH_SIZE',
  10,
  1,
  10,
);
export const TITLE_REVIEW_BATCH_CONCURRENCY = envInt(
  'JOB_TITLE_REVIEW_CONCURRENCY',
  10,
  1,
  32,
);

export const AI_ANALYZE_BATCH_SIZE = envInt(
  'JOB_AI_ANALYZE_BATCH_SIZE',
  6,
  1,
  12,
);
export const AI_ANALYZE_BATCH_CONCURRENCY = envInt(
  'JOB_AI_ANALYZE_BATCH_CONCURRENCY',
  8,
  1,
  32,
);

export const AI_STALE_CLAIM_MS = envInt(
  'JOB_AI_STALE_CLAIM_MS',
  15 * 60_000,
  60_000,
  60 * 60_000,
);

export const LLM_CHAT_TIMEOUT_MS = envInt(
  'LLM_CHAT_TIMEOUT_MS',
  90_000,
  5_000,
  300_000,
);
export const LLM_CHAT_RETRIES = envInt('LLM_CHAT_RETRIES', 3, 0, 8);

/** Parallel Job Search résumé jobs (each job already runs section steps in parallel). */
export const JOB_SEARCH_RESUME_CONCURRENCY = envInt(
  'JOB_SEARCH_RESUME_CONCURRENCY',
  8,
  1,
  12,
);

/** Fail one Job Search résumé if it has not finished (covers hung LLM fetches). */
export const RESUME_GENERATE_JOB_TIMEOUT_MS = envInt(
  'RESUME_GENERATE_JOB_TIMEOUT_MS',
  120_000,
  20_000,
  300_000,
);

export const AI_ANALYZE_JD_MAX_CHARS = envInt(
  'JOB_AI_ANALYZE_JD_MAX_CHARS',
  8_000,
  1_000,
  32_000,
);

export const RESUME_ANALYZE_BATCH_SIZE = 1;
export const RESUME_ANALYZE_BATCH_CONCURRENCY = envInt(
  'RESUME_ANALYZE_BATCH_CONCURRENCY',
  12,
  1,
  32,
);

/** Parallel recommend-resume LLM calls (shared with LLM admission). */
export const RECOMMEND_RESUME_CONCURRENCY = envInt(
  'RECOMMEND_RESUME_CONCURRENCY',
  8,
  1,
  32,
);

export const MAIL_AI_LABEL_BATCH_SIZE = envInt(
  'MAIL_AI_LABEL_BATCH_SIZE',
  8,
  1,
  12,
);
export const MAIL_AI_LABEL_BATCH_CONCURRENCY = envInt(
  'MAIL_AI_LABEL_BATCH_CONCURRENCY',
  8,
  1,
  32,
);
export const MAIL_AI_LABEL_BODY_MAX_CHARS = envInt(
  'MAIL_AI_LABEL_BODY_MAX_CHARS',
  2_000,
  500,
  8_000,
);
