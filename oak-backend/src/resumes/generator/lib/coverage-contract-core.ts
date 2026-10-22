import {
  CATEGORIES,
  CONFIDENCES,
  DECISIONS,
  ORIGINS,
  PLACEMENTS,
  RESUME_COVERAGE_CONTRACT_VERSION,
} from '../constants/generator.constants';
import { aliasesForCoverageSkill } from './coverage-aliases';
import { cleanString } from './clean-string';
import { normalizeCoverageSettings } from './migrate-generator-config';

type AnalysisLike = {
  fingerprint?: unknown;
  skills?: Array<Record<string, unknown>>;
};

type EvidenceEntry = {
  roleIndex: number | null;
  company: string;
  title: string;
  excerpt: string;
};

function mapEvidence(raw: unknown): EvidenceEntry[] {
  return (Array.isArray(raw) ? raw : [])
    .map((entry) => {
      const e = (entry && typeof entry === 'object' ? entry : {}) as Record<
        string,
        unknown
      >;
      return {
        roleIndex: Number.isInteger(e?.roleIndex)
          ? (e.roleIndex as number)
          : null,
        company: cleanString(e?.company),
        title: cleanString(e?.title),
        excerpt: cleanString(e?.excerpt).slice(0, 240),
      };
    })
    .filter((entry) => entry.roleIndex != null || entry.company || entry.title);
}

export function buildResumeCoverageContract(
  analysis: AnalysisLike | null | undefined,
  decisions: Record<string, unknown> = {},
  rawSettings: unknown = {},
) {
  if (!analysis || !Array.isArray(analysis.skills)) return null;
  const settings = normalizeCoverageSettings(rawSettings);
  if (!settings.enabled) return null;
  const unresolved: Array<{ id: unknown; name: unknown }> = [];
  const excluded: Array<{ id: unknown; name: unknown; reason: string }> = [];
  const skills: Array<Record<string, unknown>> = [];
  for (const item of analysis.skills) {
    const explicit = cleanString(decisions?.[String(item.id)] ?? item.decision);
    const decision = DECISIONS.has(explicit) ? explicit : null;
    if (!decision) {
      unresolved.push({ id: item.id, name: item.name });
      continue;
    }
    if (decision === 'exclude') {
      excluded.push({
        id: item.id,
        name: item.name,
        reason: 'candidate-declined',
      });
      continue;
    }
    const requirement = Math.min(
      5,
      Math.max(1, Math.round(Number(item.requirement)) || 3),
    );
    const origin = ORIGINS.has(String(item.origin ?? ''))
      ? String(item.origin)
      : 'jd';
    const evidence = mapEvidence(item.evidence);
    const verified = item.evidenceStatus === 'verified' || evidence.length > 0;
    const allowedPlacements = ['skills'];
    const mayUseInExperience =
      decision === 'used' &&
      (verified ||
        (origin === 'jd' &&
          requirement >= settings.experienceRequirementThreshold));
    if (mayUseInExperience) allowedPlacements.push('experience');
    const requiredPlacements = ['skills'];
    if (
      mayUseInExperience &&
      origin === 'jd' &&
      requirement >= settings.experienceRequirementThreshold
    ) {
      requiredPlacements.push('experience');
    }
    skills.push({
      id: cleanString(item.id),
      name: cleanString(item.name),
      aliases: aliasesForCoverageSkill(item, settings.aliases),
      category: CATEGORIES.has(String(item.category ?? ''))
        ? item.category
        : 'tool',
      origin,
      confidence: CONFIDENCES.has(String(item.confidence ?? ''))
        ? item.confidence
        : origin === 'inferred'
          ? 'commonly_expected'
          : 'explicit',
      inferredFrom: (Array.isArray(item.inferredFrom) ? item.inferredFrom : [])
        .map(cleanString)
        .filter(Boolean)
        .slice(0, 12),
      requirement,
      evidenceStatus: verified
        ? 'verified'
        : decision === 'used'
          ? 'candidate-confirmed'
          : 'unverified',
      evidence,
      decision,
      allowedPlacements,
      requiredPlacements,
      placements: requiredPlacements,
    });
  }
  return {
    schemaVersion: RESUME_COVERAGE_CONTRACT_VERSION,
    sourceAnalysisFingerprint: cleanString(analysis.fingerprint),
    experienceRequirementThreshold: settings.experienceRequirementThreshold,
    skills,
    excluded,
    unresolved,
  };
}

/**
 * Automatic decisions the Resume Editor applies after analysis.
 * Structured Job Search / Agent runs use analysis defaults as run-scoped decisions.
 */
export function buildAutomaticResumeCoveragePayload(
  analysis: AnalysisLike | null | undefined,
  rawSettings: unknown = {},
) {
  if (!analysis || !Array.isArray(analysis.skills)) return null;
  const settings = normalizeCoverageSettings(rawSettings);
  if (!settings.enabled) return null;
  const decisions = Object.fromEntries(
    analysis.skills
      .map((skill) => {
        const supplied = cleanString(skill?.decision);
        const decision = DECISIONS.has(supplied)
          ? supplied
          : skill?.evidenceStatus === 'verified'
            ? 'used'
            : 'familiar';
        return [cleanString(skill?.id), decision] as const;
      })
      .filter(([id]) => id),
  );
  return { analysis, decisions, settings };
}

export function normalizeResumeCoverageContract(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.analysis) {
    return buildResumeCoverageContract(
      obj.analysis,
      (obj.decisions as Record<string, unknown>) || {},
      obj.settings,
    );
  }
  if (!Array.isArray(obj.skills)) return null;
  const skills = (obj.skills as Record<string, unknown>[])
    .map((item) => {
      const decision = item?.decision === 'familiar' ? 'familiar' : 'used';
      const legacyPlacements = Array.isArray(item?.placements)
        ? item.placements
        : ['skills'];
      const requiredPlacements = [
        ...new Set(
          (Array.isArray(item?.requiredPlacements)
            ? item.requiredPlacements
            : legacyPlacements
          ).filter((placement) => PLACEMENTS.has(String(placement))),
        ),
      ] as string[];
      const allowedPlacements = [
        ...new Set(
          (Array.isArray(item?.allowedPlacements)
            ? item.allowedPlacements
            : requiredPlacements
          ).filter((placement) => PLACEMENTS.has(String(placement))),
        ),
      ] as string[];
      if (!requiredPlacements.includes('skills'))
        requiredPlacements.unshift('skills');
      if (!allowedPlacements.includes('skills'))
        allowedPlacements.unshift('skills');
      return {
        id: cleanString(item?.id),
        name: cleanString(item?.name),
        aliases: aliasesForCoverageSkill(item),
        category: CATEGORIES.has(String(item?.category ?? ''))
          ? item.category
          : 'tool',
        origin: ORIGINS.has(String(item?.origin ?? '')) ? item.origin : 'jd',
        confidence: CONFIDENCES.has(String(item?.confidence ?? ''))
          ? item.confidence
          : 'explicit',
        inferredFrom: (Array.isArray(item?.inferredFrom)
          ? item.inferredFrom
          : []
        )
          .map(cleanString)
          .filter(Boolean)
          .slice(0, 12),
        requirement: Math.min(5, Math.max(1, Number(item?.requirement) || 3)),
        evidenceStatus:
          item?.evidenceStatus === 'verified'
            ? 'verified'
            : item?.evidenceStatus === 'unverified'
              ? 'unverified'
              : 'candidate-confirmed',
        evidence: mapEvidence(item?.evidence),
        decision,
        allowedPlacements,
        requiredPlacements,
        placements: requiredPlacements,
      };
    })
    .filter((item) => item.name && item.requiredPlacements.length);
  return {
    schemaVersion: RESUME_COVERAGE_CONTRACT_VERSION,
    sourceAnalysisFingerprint: cleanString(obj.sourceAnalysisFingerprint),
    experienceRequirementThreshold: 4,
    skills,
    excluded: Array.isArray(obj.excluded) ? obj.excluded : [],
    unresolved: Array.isArray(obj.unresolved) ? obj.unresolved : [],
  };
}
