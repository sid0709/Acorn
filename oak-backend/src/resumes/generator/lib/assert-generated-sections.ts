import { cleanString } from './clean-string';
import { sourceCareers } from './title-policy';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function fail(message: string): never {
  throw Object.assign(new Error(message), { status: 502 });
}

function summaryText(section: unknown): string {
  const row = asRecord(section);
  if (typeof row?.summary === 'string') return cleanString(row.summary);
  if (typeof section === 'string') return cleanString(section);
  return '';
}

function skillItemCount(section: unknown): number {
  const groups = asRecord(section)?.skills;
  if (!Array.isArray(groups)) return 0;
  return groups.reduce((count, group) => {
    const items = asRecord(group)?.items;
    if (!Array.isArray(items)) return count;
    return (
      count + items.map((item) => cleanString(item)).filter(Boolean).length
    );
  }, 0);
}

function experienceRows(section: unknown): Record<string, unknown>[] {
  const row = asRecord(section);
  if (Array.isArray(row?.experiences)) {
    return row.experiences.filter((item): item is Record<string, unknown> =>
      Boolean(asRecord(item)),
    );
  }
  if (Array.isArray(row?.experience)) {
    return row.experience.filter((item): item is Record<string, unknown> =>
      Boolean(asRecord(item)),
    );
  }
  return [];
}

function hasSubstantiveBullet(row: Record<string, unknown>): boolean {
  if (!Array.isArray(row.bullets)) return false;
  return row.bullets.some((bullet) => cleanString(bullet).length > 0);
}

function roleLabel(row: Record<string, unknown>): string {
  const title = cleanString(row.title);
  const company = cleanString(row.company);
  if (title && company) return `${title} at ${company}`;
  return company || title || 'A profile role';
}

/** Presence-only: blank Summary / Skills / Experience after trim. */
export function sectionContentMissing(
  purpose: string,
  section: unknown,
): string | null {
  const key = String(purpose || '').trim();
  if (key === 'summary') {
    return summaryText(section) ? null : 'Summary was empty.';
  }
  if (key === 'skills') {
    return skillItemCount(section) < 1 ? 'Skills was empty.' : null;
  }
  if (key !== 'experience') return null;
  const rows = experienceRows(section);
  if (!rows.length) return 'Experience was empty.';
  const incomplete = rows.filter(
    (row) => !cleanString(row.company) || !hasSubstantiveBullet(row),
  );
  if (!incomplete.length) return null;
  const labels = incomplete.map(roleLabel);
  const noun = labels.length === 1 ? 'needs' : 'need';
  return `Experience is incomplete: ${labels.join('; ')} ${noun} at least one bullet.`;
}

/**
 * Reject a generation that omitted Summary, Skills, or Experience
 * (including employer headings with no bullets).
 */
export function assertGeneratedSections(
  sections: Record<string, unknown>,
  opts: {
    required: Iterable<string>;
    identity?: Record<string, unknown> | null;
  },
) {
  const required = new Set(
    [...opts.required].map((purpose) => String(purpose || '').trim()),
  );
  for (const purpose of ['summary', 'skills'] as const) {
    if (!required.has(purpose)) continue;
    const missing = sectionContentMissing(purpose, sections[purpose]);
    if (missing) fail(missing);
  }
  if (!required.has('experience')) return;

  const rows = experienceRows(sections.experience);
  const careers = sourceCareers(opts.identity);
  if (careers.length && rows.length !== careers.length) {
    fail('Experience is missing a profile role.');
  }
  const missing = sectionContentMissing('experience', sections.experience);
  if (missing) fail(missing);
}
