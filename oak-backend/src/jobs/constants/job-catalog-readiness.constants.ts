import { JOB_TITLE_REVIEW_LABELS } from './job-pipeline.constants';

/** `aiSkillStatus` values that count as skill-pipeline complete (ready for `jobs`). */
export const JOB_SKILL_STATUS_DONE = [
  'extracted',
  'skipped_duplicate',
] as const;

export type JobSkillStatusDone = (typeof JOB_SKILL_STATUS_DONE)[number];

/** Catalog row is searchable in `jobs` only when both pipelines are done. */
export function isJobCatalogReady(job: {
  titleReviewLabel: string;
  aiSkillStatus: string | null | undefined;
}): boolean {
  if (job.titleReviewLabel !== JOB_TITLE_REVIEW_LABELS.APPROVED) return false;
  const status = String(job.aiSkillStatus ?? '').trim();
  return (JOB_SKILL_STATUS_DONE as readonly string[]).includes(status);
}
