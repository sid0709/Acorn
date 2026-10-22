/** Shape merged onto Job Search list/detail docs from vendor_tasks or job_statuses. */
export type JobRecommendFields = {
  recommendedResumeStack: string | null;
  recommendedResumeId: string | null;
  recommendedResumeReason: string | null;
  useCustomizedResume: boolean;
  recommendWarning: string | null;
  recommendedAt: string | null;
  recommendMode: string | null;
};

export function hasStoredRecommendation(row: {
  recommendedResumeStack?: string | null;
  recommendedResumeId?: string | null;
  useCustomizedResume?: boolean | null;
  recommendedAt?: Date | string | null;
  recommendedResumeReason?: string | null;
  recommendWarning?: string | null;
}): boolean {
  if (row.recommendedAt) return true;
  if (String(row.recommendedResumeStack || '').trim()) return true;
  if (String(row.recommendedResumeId || '').trim()) return true;
  if (row.useCustomizedResume) return true;
  if (String(row.recommendedResumeReason || '').trim()) return true;
  if (String(row.recommendWarning || '').trim()) return true;
  return false;
}

export function mapVendorTaskRecommendFields(row: {
  recommendedResumeStack?: string | null;
  recommendedResumeId?: string | null;
  recommendedResumeReason?: string | null;
  useCustomizedResume?: boolean | null;
  recommendWarning?: string | null;
  recommendedAt?: Date | string | null;
  recommendMode?: string | null;
}): JobRecommendFields {
  const recommendedAt =
    row.recommendedAt instanceof Date
      ? row.recommendedAt.toISOString()
      : typeof row.recommendedAt === 'string' && row.recommendedAt.trim()
        ? row.recommendedAt.trim()
        : null;

  return {
    recommendedResumeStack:
      String(row.recommendedResumeStack || '').trim() || null,
    recommendedResumeId: String(row.recommendedResumeId || '').trim() || null,
    recommendedResumeReason:
      String(row.recommendedResumeReason || '').trim() || null,
    useCustomizedResume: Boolean(row.useCustomizedResume),
    recommendWarning: String(row.recommendWarning || '').trim() || null,
    recommendedAt,
    recommendMode:
      row.recommendMode === 'llm' ||
      row.recommendMode === 'heuristic' ||
      row.recommendMode === 'manual'
        ? row.recommendMode
        : null,
  };
}

/** Prisma/Mongo write shape for job_statuses recommend columns. */
export function recommendFieldsToStatusWrite(fields: JobRecommendFields): {
  recommendedResumeStack: string | null;
  recommendedResumeId: string | null;
  recommendedResumeReason: string | null;
  useCustomizedResume: boolean;
  recommendWarning: string | null;
  recommendedAt: Date | null;
  recommendMode: string | null;
} {
  const parsed = fields.recommendedAt ? new Date(fields.recommendedAt) : null;
  const id = String(fields.recommendedResumeId || '').trim();
  return {
    recommendedResumeStack: fields.recommendedResumeStack,
    recommendedResumeId: /^[a-f\d]{24}$/i.test(id) ? id : null,
    recommendedResumeReason: fields.recommendedResumeReason,
    useCustomizedResume: fields.useCustomizedResume,
    recommendWarning: fields.recommendWarning,
    recommendedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
    recommendMode: fields.recommendMode,
  };
}

export function absorbRecommendFallback(
  out: Map<string, JobRecommendFields>,
  fallback: Map<string, JobRecommendFields>,
) {
  for (const [jobId, fields] of fallback) {
    if (out.has(jobId) || out.has(jobId.toLowerCase())) continue;
    const raw = String(jobId || '').trim();
    if (!raw) continue;
    out.set(raw, fields);
    out.set(raw.toLowerCase(), fields);
  }
}
