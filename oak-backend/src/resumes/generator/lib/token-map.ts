import { cleanString } from './clean-string';

type CareerLike = {
  title?: unknown;
  company?: unknown;
  period?: unknown;
  description?: unknown;
};

type IdentityLike = {
  careers?: CareerLike[];
};

type CoverageContractLike = {
  skills?: Array<{ name?: unknown }>;
};

/** Format one career entry as a natural sentence for {companyN} tokens. */
export function formatCompanyToken(c: CareerLike | null | undefined): string {
  const title = cleanString(c?.title);
  const company = cleanString(c?.company);
  const period = cleanString(c?.period);
  const description = cleanString(c?.description);

  let head = '';
  if (title && company) head = `${title} at ${company}`;
  else head = title || company;

  if (period && head) head = `${head} (${period})`;
  else if (period) head = period;

  return description && head ? `${head} — ${description}` : head || description;
}

/**
 * Resolve prompt reference tokens from the candidate profile + JD.
 * `{career}` / `{work_experience}` are newline-joined role summaries;
 * `{companyN}` is 1-based by profile order.
 */
export function buildTokenMap(
  identity: IdentityLike | null | undefined,
  jobDescription: unknown,
  jobSkills: unknown,
): Record<string, string> {
  const careers = Array.isArray(identity?.careers) ? identity.careers : [];
  const field = (v: unknown) => cleanString(v);
  const skills = Array.isArray(jobSkills)
    ? jobSkills.map(field).filter(Boolean)
    : [];
  const career = careers
    .map((c) => {
      const parts = [
        field(c?.title),
        field(c?.company),
        field(c?.period),
      ].filter(Boolean);
      const description = field(c?.description);
      return description
        ? `${parts.join(' | ')} — ${description}`
        : parts.join(' | ');
    })
    .filter(Boolean)
    .join('\n');
  const map: Record<string, string> = {
    job_description: cleanString(jobDescription),
    job_skills: skills.join(', '),
    career,
    // Legacy / custom prompt alias used in Editor-core step templates.
    work_experience: career,
  };
  careers.forEach((c, i) => {
    map[`company${i + 1}`] = formatCompanyToken(c);
  });
  return map;
}

/** Format prior step output for `{draft_<purpose>}` prompt tokens. */
export function formatDraftToken(output: unknown): string {
  if (output == null) return '';
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

/** Prefer coverage-contract skill names; fall back to extracted job skills. */
export function resolveResumePromptSkills(
  jobSkills: unknown,
  coverageContract: CoverageContractLike | null | undefined,
): string[] {
  const contractSkills = Array.isArray(coverageContract?.skills)
    ? coverageContract.skills
        .map((skill) => cleanString(skill?.name))
        .filter(Boolean)
    : [];
  if (contractSkills.length) return contractSkills;
  return Array.isArray(jobSkills)
    ? jobSkills.map(cleanString).filter(Boolean)
    : [];
}
