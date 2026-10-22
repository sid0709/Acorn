/**
 * Shared career-title policy for résumé generation.
 * Dynamic titles enabled: JD-aware concise titles. Disabled: exact Profile titles.
 */
import { TITLE_POLICY_VERSION } from '../constants/generator.constants';
import { cleanString } from './clean-string';
import { matchExperienceRows } from './match-experience-row';
import {
  computeTitlePolicyFingerprint,
  titlePolicyConfigSlice,
} from './title-policy-fingerprint';

export {
  TITLE_POLICY_VERSION,
  computeTitlePolicyFingerprint,
  titlePolicyConfigSlice,
};

type CareerLike = {
  title?: unknown;
  company?: unknown;
  period?: unknown;
  description?: unknown;
};

type IdentityLike = { careers?: CareerLike[] };

export function sourceCareers(
  identity: IdentityLike | null | undefined,
): CareerLike[] {
  return Array.isArray(identity?.careers) ? identity.careers : [];
}

/** Slash/keyword stacking, pipe-joined titles, or long keyword-list titles. */
export function isStackedOrMalformedTitle(title: unknown): boolean {
  const t = cleanString(title);
  if (!t) return true;
  if (t.length > 80) return true;
  if (/[|/]/.test(t)) return true;
  if ((t.match(/,/g) || []).length >= 2) return true;
  return false;
}

/** Concise conventional résumé title suitable for dynamic-title acceptance. */
export function isAcceptableDynamicTitle(title: unknown): boolean {
  const t = cleanString(title);
  if (!t) return false;
  if (isStackedOrMalformedTitle(t)) return false;
  if ((t.match(/\band\b/gi) || []).length >= 2) return false;
  return true;
}

function formatAuthoritativeCareers(careers: CareerLike[]): string {
  return careers
    .map((c, i) => {
      const parts = [
        `#${i + 1}`,
        cleanString(c?.title) || '(untitled)',
        cleanString(c?.company) ? `@ ${cleanString(c.company)}` : '',
        cleanString(c?.period) ? `(${cleanString(c.period)})` : '',
      ].filter(Boolean);
      const desc = cleanString(c?.description);
      return desc ? `${parts.join(' ')} — ${desc}` : parts.join(' ');
    })
    .join('\n');
}

/** Mandatory Experience-step appendix. Enforced again in reconcileExperienceTitles. */
export function buildExperienceTitleGuidance({
  dynamicCareerTitles,
  jobDescription,
  careers,
}: {
  dynamicCareerTitles?: boolean;
  jobDescription?: unknown;
  careers?: CareerLike[];
}): string {
  const list = Array.isArray(careers) ? careers : [];
  const sequence = authoritativeSequence(list);
  if (!dynamicCareerTitles) {
    return `

TITLE POLICY (mandatory — dynamic career titles disabled):
- Keep each experience job title EXACTLY as given in the candidate profile / Profile Settings.
- Do not rename, rephrase, shorten, expand, or tailor titles to the job description.
- You may rewrite bullets only; company names and dates stay as given.
${sequence}`;
  }

  const jd = cleanString(jobDescription) || '(no job description provided)';

  return `

TITLE POLICY (mandatory — dynamic career titles enabled):
Target job description:
<<<
${jd}
>>>

${sequence}
- Propose one concise, conventional résumé title per role (e.g. "Senior Backend Engineer").
- Align specialization to that role's responsibilities and the target JD when supported by the experience.
- You may infer seniority freely, but the overall sequence must remain humanly plausible chronologically.
- Domain transitions (e.g. Java → backend → full stack, or data → AI) are allowed only when each role's experience supports them.
- PROHIBITED: slash or keyword stacking such as "Senior/Staff Backend/Java Engineer", pipe-joined titles, or comma-stuffed keyword lists.
- Preserve company names and dates from the authoritative sequence; rewrite bullets as usual.`;
}

function authoritativeSequence(careers: CareerLike[]): string {
  const sequence = careers.length
    ? formatAuthoritativeCareers(careers)
    : '(no careers on profile)';
  const count = careers.length;
  return `Authoritative career sequence from Profile Settings (preserve count, order, company, and dates):
<<<
${sequence}
>>>
- Return exactly ${count} experience object${count === 1 ? '' : 's'}, one per role above, in that order.
- If an earlier instruction, bullet quota, or schema maxItems asks for a different number of roles, ignore that count.
- Give every role at least one substantive bullet. If a role's profile description is blank, or the draft omitted it, still include it with one or two conservative bullets grounded in that role's title and dates.`;
}

/** Append title policy to an Experience final-step prompt (tokens already applied). */
export function appendExperienceTitlePolicy(
  prompt: unknown,
  opts: {
    dynamicCareerTitles?: boolean;
    jobDescription?: unknown;
    careers?: CareerLike[];
  },
): string {
  return `${cleanString(prompt)}${buildExperienceTitleGuidance(opts)}`;
}

function experienceListFromSection(
  section: unknown,
): Record<string, unknown>[] {
  if (!section || typeof section !== 'object') return [];
  const s = section as Record<string, unknown>;
  if (Array.isArray(s.experiences))
    return s.experiences as Record<string, unknown>[];
  if (Array.isArray(s.experience))
    return s.experience as Record<string, unknown>[];
  return [];
}

/**
 * Reconcile model Experience JSON against Profile careers.
 * Always preserve career count/order, company, and dates from Profile Settings.
 */
export function reconcileExperienceTitles(
  section: unknown,
  identity: IdentityLike | null | undefined,
  dynamicCareerTitles: boolean,
): { experiences: Array<Record<string, unknown>> } {
  const careers = sourceCareers(identity);
  const modelList = experienceListFromSection(section);
  const matched = matchExperienceRows(careers, modelList);

  const experiences = careers.map((career, i) => {
    const model = matched[i] || {};
    const sourceTitle = cleanString(career?.title);
    let title = sourceTitle;
    if (dynamicCareerTitles) {
      const suggested = cleanString(model.title);
      if (isAcceptableDynamicTitle(suggested)) title = suggested;
    }
    const bullets = Array.isArray(model.bullets)
      ? model.bullets.map((b) => cleanString(b)).filter(Boolean)
      : [];
    const row: Record<string, unknown> = {
      company: cleanString(career?.company) || cleanString(model.company),
      title,
      period: cleanString(career?.period) || cleanString(model.period),
      bullets,
    };
    const location = cleanString(model.location);
    if (location) row.location = location;
    return row;
  });

  return { experiences };
}

/** Apply title policy to a full sections object. */
export function applyTitlePolicyToSections(
  sections: Record<string, unknown> | null | undefined,
  identity: IdentityLike | null | undefined,
  dynamicCareerTitles: unknown,
): Record<string, unknown> | null | undefined {
  if (!sections || typeof sections !== 'object') return sections;
  if (!sections.experience) return sections;
  return {
    ...sections,
    experience: reconcileExperienceTitles(
      sections.experience,
      identity,
      Boolean(dynamicCareerTitles),
    ),
  };
}
