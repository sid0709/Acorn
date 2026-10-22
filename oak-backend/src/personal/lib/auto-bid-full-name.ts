import { asText } from '../mappers/as-text';

/** Recruiter-facing name from the autobid profile, else the account username. */
export function autoBidFullName(
  autoBidProfile: unknown,
  accountName = '',
): string {
  const profile =
    autoBidProfile &&
    typeof autoBidProfile === 'object' &&
    !Array.isArray(autoBidProfile)
      ? (autoBidProfile as Record<string, unknown>)
      : {};
  const fullName = asText(profile.fullName).trim();
  if (fullName) return fullName;
  const joined = [
    asText(profile.firstName).trim(),
    asText(profile.lastName).trim(),
  ]
    .filter(Boolean)
    .join(' ');
  return joined || String(accountName || '').trim();
}
