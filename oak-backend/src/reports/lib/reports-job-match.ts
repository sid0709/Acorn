import { scrapeSourceMatchClause } from '../../jobs/lib/scrape-source-match';
import { REPORT_EMPTY_SOURCE } from '../constants/reports.constants';
import {
  mongoDateFieldMatch,
  type ParsedDateRange,
} from './reports-date-range';

function sourceMatchClause(sources: string[]): Record<string, unknown> | null {
  if (!sources.length) return null;

  const hasOther = sources.includes(REPORT_EMPTY_SOURCE);
  const keys = sources.filter((value) => value !== REPORT_EMPTY_SOURCE);

  if (!hasOther) {
    return keys.length ? { source: { $in: keys } } : null;
  }

  const other = [
    { source: { $exists: false } },
    { source: null },
    { source: '' },
    { source: REPORT_EMPTY_SOURCE },
  ];
  return keys.length
    ? { $or: [{ source: { $in: keys } }, ...other] }
    : { $or: other };
}

/** `$match` for Analytics posting aggregations (postedAt + source + scrape). */
export function reportsJobMatch(
  range: ParsedDateRange,
  scrapeSources: string[],
  sources: string[] = [],
): Record<string, unknown> | null {
  const parts: Record<string, unknown>[] = [];
  const date = mongoDateFieldMatch('postedAt', range);
  if (date) parts.push(date);
  const scrape = scrapeSourceMatchClause(scrapeSources);
  if (scrape) parts.push(scrape);
  const source = sourceMatchClause(sources);
  if (source) parts.push(source);
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : { $and: parts };
}
