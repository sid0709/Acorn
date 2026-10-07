/**
 * Native typed inputs only accept their HTML value format: a date input silently
 * drops "2009-08" or "8/2009" and stays empty. Convert the planned answer to the
 * input type's format before writing it. Parsing is by shape only — no locale or
 * site rules beyond US month/day order for slash dates.
 */

const MONTH_NAMES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

type DateParts = { year: number; month: number; day: number };

const pad = (n: number) => String(n).padStart(2, "0");

function validParts(year: number, month: number, day: number): DateParts | null {
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function monthFromName(name: string): number {
  const index = MONTH_NAMES.indexOf(name.slice(0, 3).toLowerCase() as (typeof MONTH_NAMES)[number]);
  return index + 1;
}

/** A calendar date from ISO, slash, or month-name text. A missing day is the 1st. */
export function parseDateParts(text: string): DateParts | null {
  const value = text.trim();
  let match = value.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (match) return validParts(+match[1], +match[2], match[3] ? +match[3] : 1);
  match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (match) return validParts(+match[3], +match[1], +match[2]);
  match = value.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (match) return validParts(+match[2], +match[1], 1);
  match = value.match(/^([a-z]{3,})\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/i);
  if (match) return validParts(+match[3], monthFromName(match[1]), match[2] ? +match[2] : 1);
  match = value.match(/^(\d{4})$/);
  if (match) return validParts(+match[1], 1, 1);
  return null;
}

/** "9:30 AM", "14:05", "9am" → "HH:MM". */
function parseTime(text: string): string | null {
  const match = text.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i);
  if (!match) return null;
  let hour = +match[1];
  const minute = match[2] ? +match[2] : 0;
  const half = match[3]?.toLowerCase();
  if (half === "p" && hour < 12) hour += 12;
  if (half === "a" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

/** The planned value in the format this input type accepts; unchanged when it cannot convert. */
export function formatForInputType(type: string, value: string): string {
  switch (type) {
    case "date": {
      const parts = parseDateParts(value);
      return parts ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` : value;
    }
    case "month": {
      const parts = parseDateParts(value);
      return parts ? `${parts.year}-${pad(parts.month)}` : value;
    }
    case "datetime-local": {
      const parts = parseDateParts(value);
      return parts ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T00:00` : value;
    }
    case "time":
      return parseTime(value) ?? value;
    case "number": {
      const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
      return match ? match[0] : value;
    }
    default:
      return value;
  }
}
