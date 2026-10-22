import { createHash } from 'node:crypto';
import { toCanonical } from '@nextoffer/shared/skill-normalize';
import {
  CATEGORIES,
  CONFIDENCES,
  RESUME_COVERAGE_ANALYSIS_VERSION,
} from '../constants/generator.constants';
import { cleanString } from './clean-string';
import {
  aliasesForCoverageSkill,
  isNamedResumeCoverageSkill,
  isNamedTechnologySurface,
  textContainsCoverageSkill,
} from './coverage-aliases';
import {
  analysisFingerprint,
  careerCorpus,
  evidenceForSkill,
  extractParentheticalCoverageCandidates,
  type IdentityLike,
} from './coverage-evidence';

function parseJsonObject(content: unknown): Record<string, unknown> | null {
  const raw = cleanString(content);
  if (!raw) return null;
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(unfenced) as Record<string, unknown>;
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(unfenced.slice(start, end + 1)) as Record<
        string,
        unknown
      >;
    } catch {
      return null;
    }
  }
}

type SkillRow = Record<string, unknown> & {
  id: string;
  name: string;
  aliases: string[];
  evidence: ReturnType<typeof evidenceForSkill>;
  requirement: number;
  origin: string;
};

/** Parse model coverage JSON into a grounded analysis ledger. */
export function parseResumeCoverageAnalysis(
  content: unknown,
  {
    jobDescription,
    identity,
    aliases = {},
  }: {
    jobDescription?: unknown;
    identity?: IdentityLike | null;
    aliases?: Record<string, string[]>;
    experienceRequirementThreshold?: unknown;
  } = {},
) {
  const parsed = parseJsonObject(content);
  const rows = Array.isArray(parsed?.skills)
    ? (parsed.skills as Record<string, unknown>[])
    : [];
  const careerText = careerCorpus(identity);
  const deduped = new Map<string, SkillRow>();
  const inferredRows: Record<string, unknown>[] = [];

  const upsertExplicit = (entry: SkillRow) => {
    const canonical = toCanonical(entry.name);
    if (!canonical) return;
    const previous = deduped.get(canonical);
    if (!previous) {
      deduped.set(canonical, entry);
      return;
    }
    const evidence = [
      ...new Map(
        [...(previous.evidence || []), ...(entry.evidence || [])].map(
          (item) => [`${item.roleIndex}:${item.company}:${item.title}`, item],
        ),
      ).values(),
    ];
    const aliasesMerged = [
      ...new Set([...(previous.aliases || []), ...(entry.aliases || [])]),
    ];
    const preferEntry = entry.origin === 'jd' && previous.origin !== 'jd';
    deduped.set(canonical, {
      ...(preferEntry ? previous : entry),
      ...(preferEntry ? entry : previous),
      origin:
        previous.origin === 'jd' || entry.origin === 'jd' ? 'jd' : 'career',
      confidence: 'explicit',
      requirement: Math.max(previous.requirement, entry.requirement),
      aliases: aliasesMerged,
      evidence,
    });
  };

  for (const row of rows.slice(0, 120)) {
    const name = cleanString(row?.name);
    if (!name) continue;
    const itemAliases = aliasesForCoverageSkill(
      { name, aliases: row?.aliases },
      aliases,
    );
    const candidate = { name, aliases: itemAliases };
    const inJob =
      textContainsCoverageSkill(jobDescription, candidate, aliases) &&
      isNamedResumeCoverageSkill(candidate, jobDescription, aliases);
    const evidence = evidenceForSkill(identity, candidate, aliases);
    const inCareer =
      Boolean(evidence.length) &&
      textContainsCoverageSkill(careerText, candidate, aliases) &&
      isNamedResumeCoverageSkill(candidate, careerText, aliases);
    if (!inJob && !inCareer) {
      if (row?.origin === 'inferred' && isNamedTechnologySurface(name)) {
        inferredRows.push(row);
      }
      continue;
    }
    const canonical = toCanonical(name);
    const rawRequirement = Math.min(
      5,
      Math.max(1, Math.round(Number(row?.requirement)) || 3),
    );
    const origin = inJob ? 'jd' : 'career';
    upsertExplicit({
      id: createHash('sha1').update(canonical).digest('hex').slice(0, 12),
      name,
      aliases: itemAliases.filter(
        (alias) =>
          alias.toLocaleLowerCase('en-US') !== name.toLocaleLowerCase('en-US'),
      ),
      category: CATEGORIES.has(String(row?.category ?? ''))
        ? row.category
        : 'tool',
      origin,
      confidence: 'explicit',
      inferredFrom: [],
      requirement:
        origin === 'jd' ? rawRequirement : Math.min(3, rawRequirement),
      sourceText: cleanString(row?.sourceText).slice(0, 280),
      evidence,
    });
  }

  for (const candidate of extractParentheticalCoverageCandidates(
    jobDescription,
  )) {
    const canonical = toCanonical(candidate.name);
    const existing = deduped.get(canonical);
    if (existing) {
      if (candidate.requirement > existing.requirement) {
        deduped.set(canonical, {
          ...existing,
          requirement: candidate.requirement,
        });
      }
      continue;
    }
    if (
      [...deduped.values()].some((skill) =>
        textContainsCoverageSkill(candidate.name, skill, aliases),
      )
    ) {
      continue;
    }
    const itemAliases = aliasesForCoverageSkill(candidate, aliases);
    upsertExplicit({
      id: createHash('sha1').update(canonical).digest('hex').slice(0, 12),
      ...candidate,
      aliases: itemAliases.filter(
        (alias) =>
          alias.toLocaleLowerCase('en-US') !==
          candidate.name.toLocaleLowerCase('en-US'),
      ),
      origin: 'jd',
      confidence: 'explicit',
      inferredFrom: [],
      evidence: evidenceForSkill(identity, candidate, aliases),
    });
  }

  const explicitAnchorKeys = new Set<string>();
  for (const skill of deduped.values()) {
    for (const value of [skill.name, ...(skill.aliases || [])]) {
      const key = toCanonical(value);
      if (key) explicitAnchorKeys.add(key);
    }
  }
  let inferredCount = 0;
  for (const row of inferredRows) {
    if (inferredCount >= 24) break;
    const name = cleanString(row?.name);
    const canonical = toCanonical(name);
    if (!canonical || deduped.has(canonical)) continue;
    const confidence =
      CONFIDENCES.has(String(row?.confidence ?? '')) &&
      row.confidence !== 'explicit'
        ? String(row.confidence)
        : null;
    if (!confidence) continue;
    const inferredFrom = [
      ...new Set(
        (Array.isArray(row?.inferredFrom) ? row.inferredFrom : [])
          .map(cleanString)
          .filter(Boolean),
      ),
    ];
    const anchored = [
      ...new Set(
        inferredFrom
          .map(toCanonical)
          .filter((key) => explicitAnchorKeys.has(key)),
      ),
    ];
    if (anchored.length < 2) continue;
    const itemAliases = aliasesForCoverageSkill(
      { name, aliases: row?.aliases },
      aliases,
    );
    const candidate = { name, aliases: itemAliases };
    if (textContainsCoverageSkill(jobDescription, candidate, aliases)) continue;
    if (textContainsCoverageSkill(careerText, candidate, aliases)) continue;
    const requirement = Math.min(
      3,
      Math.max(1, Math.round(Number(row?.requirement)) || 2),
    );
    deduped.set(canonical, {
      id: createHash('sha1').update(canonical).digest('hex').slice(0, 12),
      name,
      aliases: itemAliases.filter(
        (alias) =>
          alias.toLocaleLowerCase('en-US') !== name.toLocaleLowerCase('en-US'),
      ),
      category: CATEGORIES.has(String(row?.category ?? ''))
        ? row.category
        : 'tool',
      origin: 'inferred',
      confidence,
      inferredFrom,
      requirement,
      sourceText: cleanString(row?.sourceText).slice(0, 280),
      evidence: [],
    });
    inferredCount += 1;
  }

  const skills = [...deduped.values()]
    .sort(
      (left, right) =>
        right.requirement - left.requirement ||
        left.name.localeCompare(right.name),
    )
    .map((skill) => ({
      ...skill,
      evidenceStatus: skill.evidence.length ? 'verified' : 'unverified',
      decision: skill.evidence.length ? 'used' : 'familiar',
    }));

  return {
    schemaVersion: RESUME_COVERAGE_ANALYSIS_VERSION,
    fingerprint: analysisFingerprint(jobDescription, identity, skills),
    jobDescriptionHash: createHash('sha256')
      .update(String(jobDescription ?? ''))
      .digest('hex'),
    skills,
    unresolvedCount: skills.filter((skill) => !skill.decision).length,
  };
}

export {
  analysisFingerprint,
  careerCorpus,
  evidenceForSkill,
  extractParentheticalCoverageCandidates,
} from './coverage-evidence';
