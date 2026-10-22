import {
  mongoFieldIdIn,
  mongoFieldIdNin,
  toMongoDate,
} from '../../prisma/mongo-standalone';
import type { ListJobsQueryDto } from '../dto/list-jobs.query.dto';
import { scrapeSourceMatchClause } from './scrape-source-match';

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseSources(raw: string | undefined): string[] {
  const text = String(raw ?? '').trim();
  if (!text || text === 'all') return [];
  return [
    ...new Set(
      text
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

const WORK_MODE_VALUES = ['remote', 'hybrid', 'onsite'] as const;
type WorkModeValue = (typeof WORK_MODE_VALUES)[number];

function parseWorkModes(raw: string | undefined): WorkModeValue[] {
  const text = String(raw ?? '').trim();
  if (!text || text === 'all') return [];
  const allowed = new Set<string>(WORK_MODE_VALUES);
  const selected = new Set<WorkModeValue>();
  for (const part of text.split(',')) {
    const value = part.trim().toLowerCase();
    if (allowed.has(value)) selected.add(value as WorkModeValue);
  }
  return WORK_MODE_VALUES.filter((value) => selected.has(value));
}

const REMOTE_FIELD = 'metadata.details.remote';
const REMOTE_CLAUSE = {
  [REMOTE_FIELD]: { $regex: 'remote', $options: 'i' },
};
const HYBRID_CLAUSE = {
  [REMOTE_FIELD]: { $regex: 'hybrid', $options: 'i' },
};
const ONSITE_CLAUSE = { $nor: [REMOTE_CLAUSE, HYBRID_CLAUSE] };

function workModeMatchClause(
  modes: WorkModeValue[],
): Record<string, unknown> | null {
  if (!modes.length || modes.length === WORK_MODE_VALUES.length) return null;
  const clauses: Record<string, unknown>[] = [];
  if (modes.includes('remote')) clauses.push(REMOTE_CLAUSE);
  if (modes.includes('hybrid')) clauses.push(HYBRID_CLAUSE);
  if (modes.includes('onsite')) clauses.push(ONSITE_CLAUSE);
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

function mergeMatchClause(
  match: Record<string, unknown>,
  clause: Record<string, unknown> | null,
): void {
  if (!clause) return;
  if (clause.$or && match.$or) {
    const priorOr = match.$or;
    delete match.$or;
    const and = Array.isArray(match.$and) ? [...(match.$and as unknown[])] : [];
    match.$and = [...and, { $or: priorOr }, { $or: clause.$or }];
    return;
  }
  Object.assign(match, clause);
}

function parseDayStart(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const d = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDayEnd(isoDate: string): Date | null {
  const start = parseDayStart(isoDate);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

export type JobsIdConstraint =
  { includeIds: string[] } | { excludeIds: string[] } | null;

/** Mongo $match for filtered company grouping and status-tab counts. */
export function buildJobsMongoMatch(
  query: ListJobsQueryDto,
  idConstraint: JobsIdConstraint = null,
): Record<string, unknown> {
  const match: Record<string, unknown> = {
    companyId: { $exists: true, $ne: null },
  };

  if (idConstraint && 'includeIds' in idConstraint) {
    Object.assign(match, mongoFieldIdIn('_id', idConstraint.includeIds));
  } else if (
    idConstraint &&
    'excludeIds' in idConstraint &&
    idConstraint.excludeIds.length
  ) {
    Object.assign(match, mongoFieldIdNin('_id', idConstraint.excludeIds));
  }

  const q = String(query.q ?? '').trim();
  if (q) {
    match.title = { $regex: escapeRegex(q), $options: 'i' };
  }

  const company = String(query.company ?? '').trim();
  if (company) {
    match.companyName = { $regex: escapeRegex(company), $options: 'i' };
  }

  const sources = parseSources(query.source);
  if (sources.length) {
    match.source = { $in: sources };
  }

  mergeMatchClause(
    match,
    scrapeSourceMatchClause(parseSources(query.scrapeSource)),
  );
  mergeMatchClause(match, workModeMatchClause(parseWorkModes(query.workMode)));

  // $runCommandRaw requires Extended JSON dates ({ $date }), not JS Date /
  // ISO strings — otherwise BSON Date postedAt never matches the range.
  const from = query.postedFrom
    ? toMongoDate(parseDayStart(query.postedFrom))
    : null;
  const to = query.postedTo ? toMongoDate(parseDayEnd(query.postedTo)) : null;
  if (from || to) {
    match.postedAt = {
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lte: to } : {}),
    };
  }

  if (query.aiExtracted) {
    match.aiSkillStatus = 'extracted';
  }

  return match;
}

/** Source, scrape source, work mode, posted date, title/company text, or AI-extracted flag. */
export function hasAttributeFilters(query: ListJobsQueryDto): boolean {
  return (
    parseSources(query.source).length > 0 ||
    parseSources(query.scrapeSource).length > 0 ||
    parseWorkModes(query.workMode).length > 0 ||
    Boolean(String(query.q ?? '').trim()) ||
    Boolean(String(query.company ?? '').trim()) ||
    Boolean(String(query.postedFrom ?? '').trim()) ||
    Boolean(String(query.postedTo ?? '').trim()) ||
    Boolean(query.aiExtracted)
  );
}

/** Source filter only — no work mode, title/company text, dates, or AI-extracted flag. */
export function isSourceOnlyAttributeQuery(query: ListJobsQueryDto): boolean {
  return (
    parseSources(query.source).length > 0 &&
    parseSources(query.scrapeSource).length > 0 &&
    !parseWorkModes(query.workMode).length &&
    !String(query.q ?? '').trim() &&
    !String(query.company ?? '').trim() &&
    !String(query.postedFrom ?? '').trim() &&
    !String(query.postedTo ?? '').trim() &&
    !query.aiExtracted
  );
}

export function canListBySourceBuckets(
  query: ListJobsQueryDto,
  idConstraint: JobsIdConstraint,
): boolean {
  return isSourceOnlyAttributeQuery(query) && idConstraint == null;
}

export { parseSources, parseDayStart, parseDayEnd };
