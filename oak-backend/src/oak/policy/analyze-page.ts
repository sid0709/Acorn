/** Overwrite the client's résumé flag with the server-resolved value. */
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
