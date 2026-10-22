import { cleanString } from './clean-string';

type CareerLike = { description?: unknown };
type IdentityLike = { careers?: CareerLike[] };

function careersMissingEvidence(identity: IdentityLike | null | undefined) {
  const careers = Array.isArray(identity?.careers) ? identity.careers : [];
  return careers.filter((career) => !cleanString(career?.description));
}

/** Optional guidance when profile career descriptions are blank. */
export function optionalCareerDetailsPrompt(
  identity: IdentityLike | null | undefined,
): string {
  const missing = careersMissingEvidence(identity);
  if (!missing.length) return '';
  return `OPTIONAL CAREER DETAILS — ${missing.length} career description${
    missing.length === 1 ? ' is' : 's are'
  } blank.
Career descriptions are optional and blank descriptions must not produce empty Experience roles. Infer credible, non-quantified bullets from role titles, chronology, and the job description only where needed to keep every role substantive.
Keep blank roles to one or two conservative bullets and do not invent employer-specific facts, metrics, achievements, project names, internal systems, team size, or ownership.`;
}

/** Stable candidate profile block for prompt-cache friendly system content. */
export function buildContextBlock(
  identity: Record<string, unknown> | null | undefined,
): string {
  return `CANDIDATE PROFILE — these are authoritative facts. Do not invent employers, dates, schools, or credentials.\n\n${JSON.stringify(
    identity ?? {},
    null,
    2,
  )}`;
}
