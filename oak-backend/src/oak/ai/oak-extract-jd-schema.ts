export type ExtractJdLlmResult = {
  hasJobDescription: boolean;
  jobDescription: string | null;
  reason: string;
};

export const EXTRACT_JD_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hasJobDescription', 'jobDescription', 'reason'],
  properties: {
    hasJobDescription: { type: 'boolean' },
    jobDescription: { type: ['string', 'null'] },
    reason: { type: 'string' },
  },
};

export const EXTRACT_JD_SCHEMA_NAME = 'oak_extract_jd';

export const EXTRACT_JD_FORMAT = {
  type: 'json_schema',
  name: EXTRACT_JD_SCHEMA_NAME,
  strict: true,
  schema: EXTRACT_JD_JSON_SCHEMA,
};

const NO_JD_REASON = 'No job description on this page';

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error('JD extract returned no JSON object');
}

/** Parse and normalize LLM JSON for Custom JD extract. */
export function parseExtractJdResponse(content: string): ExtractJdLlmResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(content));
  } catch {
    throw new Error('JD extract returned invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JD extract returned invalid JSON');
  }
  const row = parsed as Record<string, unknown>;
  const hasJobDescription = Boolean(row.hasJobDescription);
  const extracted =
    row.jobDescription == null
      ? null
      : String(row.jobDescription).trim() || null;
  const reason = String(row.reason ?? '').trim();
  if (!hasJobDescription || !extracted) {
    return {
      hasJobDescription: false,
      jobDescription: null,
      reason: reason || NO_JD_REASON,
    };
  }
  return {
    hasJobDescription: true,
    jobDescription: extracted,
    reason: reason || 'Job description found',
  };
}
