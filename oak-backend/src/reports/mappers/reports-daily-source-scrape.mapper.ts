import { normalizeScrapeSourceLabel } from '../../jobs/lib/scrape-source-match';
import { REPORT_EMPTY_SOURCE } from '../constants/reports.constants';
import type { DailyPostingBySourceAndScrapeRow } from './reports-response.mapper';

type AggId = {
  date?: string;
  source?: string;
  scrapeSource?: string;
};

export type DailySourceScrapeBucket = {
  _id?: AggId | string | null;
  count?: number;
};

export function mapDailySourceAndScrapeRows(
  rows: DailySourceScrapeBucket[],
): DailyPostingBySourceAndScrapeRow[] {
  const merged = new Map<string, DailyPostingBySourceAndScrapeRow>();
  for (const row of rows) {
    const id = row._id;
    if (!id || typeof id !== 'object') continue;
    const date = String(id.date || '').trim();
    const source = String(id.source || '').trim() || REPORT_EMPTY_SOURCE;
    const scrapeSource = normalizeScrapeSourceLabel(id.scrapeSource);
    const count = Number(row.count) || 0;
    if (!date || count <= 0) continue;
    const key = `${date}\0${source}\0${scrapeSource}`;
    const existing = merged.get(key);
    if (existing) {
      existing.count += count;
      continue;
    }
    merged.set(key, { date, source, scrapeSource, count });
  }
  return [...merged.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.source.localeCompare(b.source) ||
      a.scrapeSource.localeCompare(b.scrapeSource),
  );
}
