import { toCanonical } from '@nextoffer/shared/skill-normalize';
import { clampRemoteConfidence } from '../lib/canonicalize-job-remote';
import type { JobDetailsCapsule } from '../mappers/job-metadata.mapper';
import { normalizeJobDetails } from '../mappers/job-metadata.mapper';

const SKILL_CATEGORIES = new Set(['hard', 'soft', 'devops', 'tools', 'domain']);

export type AiSkillRow = {
  name: string;
  category: string;
  requirement: number;
};

export type AiAnalyzeParsedJob = {
  id: string;
  details: JobDetailsCapsule;
  remoteConfidence?: number;
  remoteReason?: string;
  skills: AiSkillRow[];
};

export type AiAnalyzeParseError = {
  code: string;
  message: string;
};

/** Parse and validate AI Analyze batch JSON. */
export function parseAiAnalyzeJson(
  content: string,
  expectedIds: string[],
): {
  valid: Map<string, AiAnalyzeParsedJob>;
  errors: Map<string, AiAnalyzeParseError>;
} {
  const valid = new Map<string, AiAnalyzeParsedJob>();
  const errors = new Map<string, AiAnalyzeParseError>();
  const expected = new Set(expectedIds);

  for (const id of expectedIds) {
    errors.set(id, {
      code: 'MISSING_RESULT',
      message: 'The model omitted this job.',
    });
  }

  let data: { jobs?: unknown };
  try {
    data = JSON.parse(String(content || '')) as { jobs?: unknown };
  } catch {
    for (const id of expectedIds) {
      errors.set(id, {
        code: 'INVALID_JSON',
        message: 'The model returned invalid JSON.',
      });
    }
    return { valid, errors };
  }

  if (!data || !Array.isArray(data.jobs)) {
    for (const id of expectedIds) {
      errors.set(id, {
        code: 'INVALID_SHAPE',
        message: 'The model response has no jobs array.',
      });
    }
    return { valid, errors };
  }

  const seen = new Set<string>();
  for (const row of data.jobs) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const idRaw = (row as { id?: unknown }).id;
    const id = typeof idRaw === 'string' ? idRaw : '';
    if (!expected.has(id)) continue;
    if (seen.has(id)) {
      errors.set(id, {
        code: 'DUPLICATE_ID',
        message: 'The model returned this job id more than once.',
      });
      continue;
    }
    seen.add(id);

    const detailsRaw = (row as { details?: unknown; metadata?: unknown })
      .details;
    const legacyMeta = (row as { metadata?: unknown }).metadata;
    const details =
      normalizeJobDetails(detailsRaw ?? mapLegacyMeta(legacyMeta)) ?? {};
    const skills = normalizeSkills((row as { skills?: unknown }).skills);
    const remoteConfidence = readRemoteConfidence(row, detailsRaw);
    const remoteReason = readRemoteReason(row, detailsRaw);

    valid.set(id, {
      id,
      details,
      skills,
      ...(remoteConfidence != null ? { remoteConfidence } : {}),
      ...(remoteReason ? { remoteReason } : {}),
    });
    errors.delete(id);
  }

  return { valid, errors };
}

function mapLegacyMeta(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const m = raw as Record<string, unknown>;
  return {
    location: m.location,
    time: m.employmentType ?? m.time,
    remote: m.remote,
    seniority: m.seniority,
    salary: m.salary,
  };
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function readRemoteConfidence(
  row: object,
  detailsRaw: unknown,
): number | undefined {
  const rowRec = asRecord(row);
  const details = asRecord(detailsRaw);
  return (
    clampRemoteConfidence(rowRec?.remoteConfidence) ??
    clampRemoteConfidence(details?.remoteConfidence)
  );
}

function readRemoteReason(
  row: object,
  detailsRaw: unknown,
): string | undefined {
  const rowRec = asRecord(row);
  const details = asRecord(detailsRaw);
  for (const value of [rowRec?.remoteReason, details?.remoteReason]) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, 240);
    }
  }
  return undefined;
}

function normalizeSkills(raw: unknown): AiSkillRow[] {
  if (!Array.isArray(raw)) return [];
  const out: AiSkillRow[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const nameValue = (item as { name?: unknown }).name;
    const nameRaw = typeof nameValue === 'string' ? nameValue.trim() : '';
    const canonical = toCanonical(nameRaw);
    if (!canonical || seen.has(canonical)) continue;
    const categoryValue = (item as { category?: unknown }).category;
    const categoryRaw =
      typeof categoryValue === 'string'
        ? categoryValue.trim().toLowerCase()
        : 'hard';
    const category = SKILL_CATEGORIES.has(categoryRaw) ? categoryRaw : 'hard';
    let requirement = Number((item as { requirement?: unknown }).requirement);
    if (!Number.isFinite(requirement)) requirement = 3;
    requirement = Math.max(1, Math.min(5, Math.round(requirement)));
    seen.add(canonical);
    out.push({
      name: displayName(nameRaw, canonical),
      category,
      requirement,
    });
  }
  return out;
}

function displayName(original: string, canonical: string): string {
  if (original && /[A-Z]/.test(original)) return original.slice(0, 80);
  return canonical
    .split(' ')
    .map((part) =>
      part.length <= 3 && part === part.toLowerCase()
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(' ')
    .slice(0, 80);
}
