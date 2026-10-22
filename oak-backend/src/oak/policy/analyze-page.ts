function trimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

/** Bound Worker-pool job id from Oak analyze `page.job.id`. */
export function jobIdFromPage(page: unknown): string | null {
  if (!page || typeof page !== 'object' || Array.isArray(page)) return null;
  const job = (page as { job?: unknown }).job;
  if (!job || typeof job !== 'object' || Array.isArray(job)) return null;
  return trimmedString((job as { id?: unknown }).id);
}

/** Custom-tab generated résumé id from Oak analyze `page.customGenerationId`. */
export function customGenerationIdFromPage(page: unknown): string | null {
  if (!page || typeof page !== 'object' || Array.isArray(page)) return null;
  return trimmedString(
    (page as { customGenerationId?: unknown }).customGenerationId,
  );
}

/** Custom-tab Library résumé id from Oak analyze `page.customLibraryResumeId`. */
export function customLibraryResumeIdFromPage(page: unknown): string | null {
  if (!page || typeof page !== 'object' || Array.isArray(page)) return null;
  return trimmedString(
    (page as { customLibraryResumeId?: unknown }).customLibraryResumeId,
  );
}

/** True when Custom Fill is running on a remembered tab (resume optional). */
export function customRememberedFromPage(page: unknown): boolean {
  if (!page || typeof page !== 'object' || Array.isArray(page)) return false;
  return (page as { customRemembered?: unknown }).customRemembered === true;
}

/** Overwrite client resume flag with the server-resolved value. */
export function withRecommendedResumeAvailable(
  page: unknown,
  available: boolean,
): Record<string, unknown> {
  const base =
    page && typeof page === 'object' && !Array.isArray(page)
      ? { ...(page as Record<string, unknown>) }
      : {};
  return { ...base, recommendedResumeAvailable: available };
}
