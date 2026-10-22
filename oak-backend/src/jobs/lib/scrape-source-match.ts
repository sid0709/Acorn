import { OTHER_JOB_SCRAPE_SOURCE } from '@nextoffer/shared/job-source';

/** Jobs ingested before `createdBy` was required. */
const LEGACY_EMPTY_CREATED_BY = 'migrate:athensai';

/** Map missing / migrated `createdBy` to the Analytics "Other" scrape source. */
export function normalizeScrapeSourceLabel(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text || text === LEGACY_EMPTY_CREATED_BY) return OTHER_JOB_SCRAPE_SOURCE;
  return text;
}

/**
 * Mongo `$match` for Job Search / Analytics scrape-source filters.
 * `createdBy` is the extension key; `Other` covers missing or migrated rows.
 */
export function scrapeSourceMatchClause(
  scrapeSources: string[],
  field = 'createdBy',
): Record<string, unknown> | null {
  if (!scrapeSources.length) return null;

  const hasOther = scrapeSources.includes(OTHER_JOB_SCRAPE_SOURCE);
  const keys = scrapeSources.filter(
    (value) => value !== OTHER_JOB_SCRAPE_SOURCE,
  );

  if (!hasOther) {
    return keys.length ? { [field]: { $in: keys } } : null;
  }

  const other = [
    { [field]: { $exists: false } },
    { [field]: null },
    { [field]: LEGACY_EMPTY_CREATED_BY },
    { [field]: '' },
  ];

  return {
    $or: keys.length ? [{ [field]: { $in: keys } }, ...other] : other,
  };
}
