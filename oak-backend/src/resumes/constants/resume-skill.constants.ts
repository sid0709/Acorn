/** Protocol caps for resume skill analysis (radar-sized shortlist). */

export const RESUME_SKILL_CATEGORIES = [
  'hard',
  'devops',
  'tools',
  'domain',
  'soft',
] as const;

export type ResumeSkillCategory = (typeof RESUME_SKILL_CATEGORIES)[number];

export const RESUME_SKILL_CATEGORY_LIMITS: Record<ResumeSkillCategory, number> =
  {
    hard: 10,
    devops: 6,
    tools: 6,
    domain: 5,
    soft: 4,
  };

export const RESUME_SKILL_TOTAL_LIMIT = 28;
export const RESUME_SKILL_LEVEL_MIN = 2;
export const RESUME_SKILL_LEVEL_MAX = 5;
export const RESUME_SKILL_TRIM_MIN_LEVEL = 2;

/** Truncate extracted text before LLM (legacy Athens-server contract). */
export const RESUME_ANALYZE_TEXT_MAX_CHARS = 12_000;
