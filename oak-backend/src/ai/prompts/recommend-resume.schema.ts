/** OpenAI / DeepSeek JSON shape for recommend-resume. */
export type RecommendResumeLlmResult = {
  isJobDescription: boolean;
  recommendedResume: string | null;
  reason: string;
};

/**
 * Structured-output schema (OpenAI json_schema).
 * Keep in sync with RECOMMEND_RESUME_SYSTEM_PROMPT.
 */
export const RECOMMEND_RESUME_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isJobDescription', 'recommendedResume', 'reason'],
  properties: {
    isJobDescription: { type: 'boolean' },
    recommendedResume: {
      type: ['string', 'null'],
    },
    reason: { type: 'string' },
  },
} as const;

export const RECOMMEND_RESUME_SCHEMA_NAME = 'recommend_resume';

/** Parse and normalize LLM JSON for recommend-resume. */
export function parseRecommendResumeResponse(
  content: string,
): RecommendResumeLlmResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('LLM returned invalid JSON for resume recommendation.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LLM returned invalid JSON for resume recommendation.');
  }
  const row = parsed as Record<string, unknown>;
  const recommended =
    row.recommendedResume == null
      ? null
      : String(row.recommendedResume).trim() || null;
  return {
    isJobDescription: Boolean(row.isJobDescription),
    recommendedResume: recommended,
    reason: String(row.reason ?? '').trim(),
  };
}
