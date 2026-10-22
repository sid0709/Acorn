import { toMongoDate } from '../../prisma/mongo-standalone';

export type ParsedDateRange = {
  start: Date | null;
  end: Date | null;
};

/** Parse ISO / date-only query strings into inclusive Date bounds. */
export function parseReportsDateRange(
  startDate?: string,
  endDate?: string,
): ParsedDateRange {
  const start = parseBound(startDate, 'start');
  const end = parseBound(endDate, 'end');
  return { start, end };
}

function parseBound(
  raw: string | undefined,
  kind: 'start' | 'end',
): Date | null {
  const text = String(raw || '').trim();
  if (!text) return null;

  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dayOnly) {
    const y = Number(dayOnly[1]);
    const m = Number(dayOnly[2]) - 1;
    const d = Number(dayOnly[3]);
    if (kind === 'start') {
      return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
    }
    return new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Mongo `$match` range on a DateTime field (Extended JSON dates). */
export function mongoDateFieldMatch(
  field: string,
  range: ParsedDateRange,
): Record<string, unknown> | null {
  const gte = range.start ? toMongoDate(range.start) : null;
  const lte = range.end ? toMongoDate(range.end) : null;
  if (!gte && !lte) return null;
  const clause: Record<string, unknown> = {};
  if (gte) clause.$gte = gte;
  if (lte) clause.$lte = lte;
  return { [field]: clause };
}

export function prismaDateFieldFilter(range: ParsedDateRange) {
  if (!range.start && !range.end) return undefined;
  return {
    ...(range.start ? { gte: range.start } : {}),
    ...(range.end ? { lte: range.end } : {}),
  };
}
