const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const DOTTED_YEAR_MONTH = /^(\d{4})\.(\d{1,2})$/;

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function formatResumeMonthYear(year: string, month: string): string {
  const y = year.trim();
  const m = month.trim();
  if (!y && !m) return '';
  const monthNum = parseInt(m, 10);
  const abbr = monthNum >= 1 && monthNum <= 12 ? MONTH_ABBR[monthNum - 1] : '';
  if (abbr && y) return `${abbr} ${y}`;
  if (y) return y;
  return abbr;
}

/** Profile start/end fields → "Apr 2022 – Present". */
export function formatResumePeriodFromProfile(row: {
  startYear?: unknown;
  startMonth?: unknown;
  endYear?: unknown;
  endMonth?: unknown;
  endPresent?: unknown;
}): string {
  const start = formatResumeMonthYear(
    asText(row.startYear),
    asText(row.startMonth),
  );
  const end = row.endPresent
    ? 'Present'
    : formatResumeMonthYear(asText(row.endYear), asText(row.endMonth));
  if (!start && !end) return '';
  return `${start || '?'} – ${end || '?'}`;
}

/** Convert stored labels like "2022.4 – Present" to "Apr 2022 – Present". */
export function formatResumePeriodLabel(period: string): string {
  if (!period) return '';
  return period
    .split(/(\s*[–\-—]\s*)/)
    .map((part, i) => (i % 2 === 1 ? part : formatResumeDateToken(part)))
    .join('');
}

function formatResumeDateToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return token;
  if (/^present$/i.test(trimmed)) {
    return token.replace(trimmed, 'Present');
  }
  const dotted = trimmed.match(DOTTED_YEAR_MONTH);
  if (!dotted) return token;
  const formatted = formatResumeMonthYear(dotted[1], dotted[2]);
  return formatted ? token.replace(trimmed, formatted) : token;
}
