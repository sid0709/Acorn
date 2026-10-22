/** Job Search link stored on generated library rows (column or legacy analysis). */
export function resumeParentJobId(row: {
  parentJobId?: string | null;
  analysis?: unknown;
}): string {
  return (
    String(row.parentJobId || '').trim() ||
    parentJobIdFromAnalysis(row.analysis) ||
    ''
  );
}

export function parentJobIdFromAnalysis(analysis: unknown): string | null {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
    return null;
  }
  const row = analysis as Record<string, unknown>;
  for (const key of [
    'generateParentJobId',
    'generate_parent_job_id',
    'parentJobId',
  ]) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function isUploadedTemplateId(
  templateId: string | null | undefined,
): boolean {
  return String(templateId || '').startsWith('upload:');
}
