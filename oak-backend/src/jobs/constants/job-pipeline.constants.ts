/** Title Review list tabs / queue states (derived from `temp_jobs`, not a membership table). */
export const TITLE_REVIEW_META_STATES = {
  PENDING: 'pending',
  REVIEW_REQUIRED: 'review_required',
  FAILED: 'failed',
} as const;

export type TitleReviewMetaState =
  (typeof TITLE_REVIEW_META_STATES)[keyof typeof TITLE_REVIEW_META_STATES];

/** Flat Job / TempJob.titleReviewLabel values. */
export const JOB_TITLE_REVIEW_LABELS = {
  APPROVED: 'APPROVED',
  PENDING: 'PENDING',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
} as const;

/**
 * Flat `aiSkillStatus` values for the AI Analyze pipeline
 * (DB field name kept for catalog compatibility).
 */
export const JOB_AI_SKILL_STATUSES = {
  PENDING: 'pending',
  ANALYZING: 'analyzing',
  EXTRACTED: 'extracted',
  FAILED: 'failed',
  SKIPPED_DUPLICATE: 'skipped_duplicate',
} as const;

/**
 * Claimable for LLM AI analyze (on APPROVED titles).
 * Promote-ready stuck rows are counted in the UI queue but promoted without LLM.
 */
export const JOB_SKILL_EXTRACT_OPEN_STATUSES = [
  JOB_AI_SKILL_STATUSES.PENDING,
  JOB_AI_SKILL_STATUSES.FAILED,
] as const;

/** Already skill-complete — reclaim only to promote into `jobs` (no LLM). */
export const JOB_SKILL_PROMOTE_ONLY_STATUSES = [
  JOB_AI_SKILL_STATUSES.EXTRACTED,
  JOB_AI_SKILL_STATUSES.SKIPPED_DUPLICATE,
] as const;

/** UI /status pending badge = LLM open + promote-ready stuck (same as “work left”). */
export const JOB_SKILL_QUEUE_STATUSES = [
  ...JOB_SKILL_EXTRACT_OPEN_STATUSES,
  ...JOB_SKILL_PROMOTE_ONLY_STATUSES,
] as const;

/** Title-review processingState values inside metadata.titleReview. */
export const TITLE_REVIEW_PROCESSING_STATES = {
  PENDING: 'pending',
  SCANNING: 'scanning',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;
