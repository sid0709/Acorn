import { formatResumePeriodFromProfile } from './format-resume-date';

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function timelineSortKey(row: Record<string, unknown>) {
  const year = parseInt(asText(row.startYear), 10) || 0;
  const month = parseInt(asText(row.startMonth), 10) || 0;
  return year * 12 + month;
}

function byNewestFirst(left: unknown, right: unknown) {
  return (
    timelineSortKey((right ?? {}) as Record<string, unknown>) -
    timelineSortKey((left ?? {}) as Record<string, unknown>)
  );
}

export type GeneratorIdentity = {
  fullName: string;
  location: string;
  email: string;
  phone: string;
  linkedin: string;
  careers: Array<{
    company: string;
    title: string;
    period: string;
    description: string;
  }>;
  education: Array<{
    school: string;
    degree: string;
    period: string;
  }>;
};

/** Map the saved career profile into the generator identity block. */
export function identityFromProfile(
  profile: Record<string, unknown>,
): GeneratorIdentity {
  const location = [asText(profile.city).trim(), asText(profile.state).trim()]
    .filter(Boolean)
    .join(', ');
  const fullName =
    asText(profile.fullName).trim() ||
    [asText(profile.firstName).trim(), asText(profile.lastName).trim()]
      .filter(Boolean)
      .join(' ');
  const careersRaw: unknown[] = Array.isArray(profile.careers)
    ? (profile.careers as unknown[])
    : [];
  const careers = careersRaw
    .slice()
    .sort(byNewestFirst)
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      return {
        company: asText(row.company),
        title: asText(row.title),
        period: formatResumePeriodFromProfile(row),
        description: asText(row.description).trim(),
      };
    })
    .filter((career) => career.company || career.title);

  const educationSource = Array.isArray(profile.educations)
    ? profile.educations
    : Array.isArray(profile.education)
      ? profile.education
      : [];
  const educationRaw: unknown[] = Array.isArray(educationSource)
    ? (educationSource as unknown[])
    : [];
  const education = educationRaw
    .slice()
    .sort(byNewestFirst)
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const degree = [
        asText(row.diploma) || asText(row.degree),
        asText(row.major) || asText(row.field),
      ]
        .filter(Boolean)
        .join(', ');
      return {
        school: asText(row.school) || asText(row.university),
        degree,
        period: formatResumePeriodFromProfile(row),
      };
    })
    .filter((item) => item.school || item.degree);

  return {
    fullName,
    location,
    email: asText(profile.email).trim(),
    phone: asText(profile.phone).trim(),
    linkedin: asText(profile.linkedin).trim(),
    careers,
    education,
  };
}

export function profileHasIdentity(profile: Record<string, unknown>): boolean {
  const identity = identityFromProfile(profile);
  if (identity.fullName || identity.email) return true;
  return identity.careers.length > 0 || identity.education.length > 0;
}
