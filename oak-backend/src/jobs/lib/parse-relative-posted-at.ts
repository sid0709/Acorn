/**
 * Best-effort parse of scraper relative dates into an absolute Date.
 * Falls back to `fallback` (default now) when unparseable.
 */
export function parseRelativePostedAt(
  raw: string | null | undefined,
  fallback: Date = new Date(),
): Date {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^reposted\s+/i, '')
    .replace(/^posted\s+/i, '');

  if (!text) return fallback;

  const absolute = Date.parse(text);
  if (Number.isFinite(absolute)) return new Date(absolute);

  if (/\bjust\s+now\b|\bmoment\b|\bseconds?\s+ago\b/.test(text)) {
    return fallback;
  }

  const minutes = text.match(/(\d+)\s*minutes?\s+ago/);
  if (minutes) {
    return new Date(fallback.getTime() - Number(minutes[1]) * 60_000);
  }

  const hours = text.match(/(\d+)\s*hours?\s+ago/);
  if (hours) {
    return new Date(fallback.getTime() - Number(hours[1]) * 3_600_000);
  }

  if (/\ban?\s+hour\s+ago\b/.test(text)) {
    return new Date(fallback.getTime() - 3_600_000);
  }

  const days = text.match(/(\d+)\s*days?\s+ago/);
  if (days) {
    return new Date(fallback.getTime() - Number(days[1]) * 86_400_000);
  }

  if (/\byesterday\b/.test(text)) {
    return new Date(fallback.getTime() - 86_400_000);
  }

  const weeks = text.match(/(\d+)\s*weeks?\s+ago/);
  if (weeks) {
    return new Date(fallback.getTime() - Number(weeks[1]) * 7 * 86_400_000);
  }

  if (/\ba\s+week\s+ago\b/.test(text)) {
    return new Date(fallback.getTime() - 7 * 86_400_000);
  }

  const months = text.match(/(\d+)\s*months?\s+ago/);
  if (months) {
    return new Date(fallback.getTime() - Number(months[1]) * 30 * 86_400_000);
  }

  if (/\ba\s+month\s+ago\b/.test(text)) {
    return new Date(fallback.getTime() - 30 * 86_400_000);
  }

  const years = text.match(/(\d+)\s*years?\s+ago/);
  if (years) {
    return new Date(fallback.getTime() - Number(years[1]) * 365 * 86_400_000);
  }

  return fallback;
}

export function cleanText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
