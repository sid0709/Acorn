import { createHash } from 'node:crypto';
import { toCanonical } from '@nextoffer/shared/skill-normalize';
import { cleanString } from './clean-string';
import {
  aliasesForCoverageSkill,
  isNamedResumeCoverageSkill,
  textContainsCoverageSkill,
} from './coverage-aliases';

export type IdentityLike = {
  careers?: Array<{
    title?: unknown;
    company?: unknown;
    description?: unknown;
  }>;
};

export type CoverageEvidence = {
  roleIndex: number;
  company: string;
  title: string;
  excerpt: string;
};

export function careerCorpus(
  identity: IdentityLike | null | undefined,
): string {
  return (Array.isArray(identity?.careers) ? identity.careers : [])
    .map((career) =>
      [career?.title, career?.description]
        .map(cleanString)
        .filter(Boolean)
        .join(' — '),
    )
    .filter(Boolean)
    .join('\n');
}

export function evidenceForSkill(
  identity: IdentityLike | null | undefined,
  skill: unknown,
  aliases: Record<string, string[]>,
): CoverageEvidence[] {
  const careers = Array.isArray(identity?.careers) ? identity.careers : [];
  const evidence: CoverageEvidence[] = [];
  for (let roleIndex = 0; roleIndex < careers.length; roleIndex += 1) {
    const career = careers[roleIndex];
    const text = [career?.title, career?.description]
      .map(cleanString)
      .filter(Boolean)
      .join(' — ');
    if (
      !textContainsCoverageSkill(
        text,
        skill as string | { name?: unknown },
        aliases,
      )
    ) {
      continue;
    }
    evidence.push({
      roleIndex,
      company: cleanString(career?.company),
      title: cleanString(career?.title),
      excerpt: cleanString(career?.description || text).slice(0, 240),
    });
  }
  return evidence.slice(0, 5);
}

export function analysisFingerprint(
  jobDescription: unknown,
  identity: unknown,
  skills: Array<Record<string, unknown>>,
): string {
  return createHash('sha256')
    .update(String(jobDescription ?? ''))
    .update('\0')
    .update(JSON.stringify(identity ?? {}))
    .update('\0')
    .update(
      JSON.stringify(
        skills.map(
          ({
            id,
            name,
            aliases,
            requirement,
            origin,
            confidence,
            inferredFrom,
          }) => ({
            id,
            name,
            aliases,
            requirement,
            origin,
            confidence,
            inferredFrom,
          }),
        ),
      ),
    )
    .digest('hex');
}

/**
 * Parenthetical technology/example lists are where extraction models most often
 * drop alternatives. Preserve every explicit named list item deterministically.
 */
export function extractParentheticalCoverageCandidates(
  jobDescription: unknown,
) {
  const text = String(jobDescription ?? '');
  const candidates: Array<{
    name: string;
    category: string;
    requirement: number;
    sourceText: string;
  }> = [];
  const seen = new Set<string>();
  const stop = new Set([
    'e.g',
    'eg',
    'i.e',
    'ie',
    'etc',
    'and more',
    'among others',
  ]);
  for (const match of text.matchAll(/\(([^()\n]{1,240})\)/g)) {
    const inside = cleanString(match[1]);
    const context = text.slice(
      Math.max(0, (match.index ?? 0) - 120),
      match.index ?? 0,
    );
    const requirement = /preferred|nice.to.have|plus/i.test(context)
      ? 2
      : /required|strong experience|hands.on experience|experience\s+(?:with|integrating|designing|building|using)|proficien|expertise/i.test(
            context,
          )
        ? 4
        : 3;
    for (const part of inside.split(/[,;/]|\bor\b/gi)) {
      const name = cleanString(part)
        .replace(/^(?:e\.g\.?|i\.e\.?|such as|including|and)\s*/i, '')
        .replace(/\betc\.?$/i, '')
        .replace(/^[–—-]+|[–—-]+$/g, '')
        .trim();
      const normalized = name.toLocaleLowerCase('en-US').replace(/\.$/, '');
      const wordCount = name.split(/\s+/).filter(Boolean).length;
      if (
        !name ||
        name.length < 2 ||
        name.length > 80 ||
        wordCount > 7 ||
        stop.has(normalized) ||
        /^\d/.test(name) ||
        /\b(?:years?|months?|remote|present|preferred qualifications?)\b/i.test(
          name,
        ) ||
        !isNamedResumeCoverageSkill(name, text)
      ) {
        continue;
      }
      const canonical = toCanonical(name);
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      candidates.push({
        name,
        category: 'method',
        requirement,
        sourceText: `(${inside})`,
      });
    }
  }
  return candidates.slice(0, 60);
}
