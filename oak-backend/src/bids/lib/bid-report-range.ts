import { dayKeyFromIso } from './day-key';

function asDayStamp(raw?: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return dayKeyFromIso(text);
}

/** Inclusive YYYY-MM-DD folder-day window. Empty bounds mean All. */
export function parseBidReportDayRange(
  since?: string,
  until?: string,
): { sinceDay: string; untilDay: string } {
  let sinceDay = asDayStamp(since);
  let untilDay = asDayStamp(until);
  if (sinceDay && untilDay && sinceDay > untilDay) {
    const swap = sinceDay;
    sinceDay = untilDay;
    untilDay = swap;
  }
  return { sinceDay, untilDay };
}

export function folderDayInRange(
  dayKey: string,
  sinceDay: string,
  untilDay: string,
): boolean {
  if (sinceDay && dayKey < sinceDay) return false;
  if (untilDay && dayKey > untilDay) return false;
  return true;
}

type DateRange = { gte?: Date; lt?: Date };

/** ±1 UTC day padding so local folder days are not clipped by timezone. */
export function paddedFolderDayBounds(
  sinceDay: string,
  untilDay: string,
): DateRange | null {
  if (!sinceDay && !untilDay) return null;
  let gte: Date | undefined;
  let lt: Date | undefined;
  if (sinceDay) {
    gte = new Date(`${sinceDay}T00:00:00.000Z`);
    gte.setUTCDate(gte.getUTCDate() - 1);
  }
  if (untilDay) {
    lt = new Date(`${untilDay}T00:00:00.000Z`);
    lt.setUTCDate(lt.getUTCDate() + 2);
  }
  return { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
}

/** Prisma `where` fragment: bidReadyDate or addedAt inside the padded window. */
export function vendorTaskPooledAtRangeWhere(
  sinceDay: string,
  untilDay: string,
):
  | { OR: Array<{ bidReadyDate?: DateRange; addedAt?: DateRange }> }
  | Record<string, never> {
  const range = paddedFolderDayBounds(sinceDay, untilDay);
  if (!range || (!range.gte && !range.lt)) return {};
  return { OR: [{ bidReadyDate: range }, { addedAt: range }] };
}
