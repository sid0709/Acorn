import {
  ALLOWED_GENDER,
  ALLOWED_IMMIGRATION_STATUS,
  ALLOWED_PRONOUNS,
  ALLOWED_RACE,
  ALLOWED_SEXUAL_ORIENTATION,
  ALLOWED_VETERAN,
  ALLOWED_YES_NO_DECLINE,
  MAX_CAREERS,
  MAX_EDUCATION,
  SERVER_MANAGED_PROFILE_FIELDS,
} from '../constants/profile-field.constants';
import { asText } from './as-text';

export type EducationEntry = {
  school: string;
  diploma: string;
  startMonth: string;
  startYear: string;
  endMonth: string;
  endYear: string;
};

export type CareerEntry = {
  company: string;
  title: string;
  description: string;
  startMonth: string;
  startYear: string;
  endPresent: boolean;
  endMonth: string;
  endYear: string;
};

export type NormalizedAutoBidProfile = {
  fullName: string;
  firstName: string;
  lastName: string;
  age: string;
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  desiredSalary: string;
  gender: string;
  pronouns: string;
  sexualOrientation: string;
  email: string;
  gmailAppPassword: string;
  openaiApiKey: string;
  deepseekApiKey: string;
  defaultProvider: string;
  defaultModel: string;
  defaultPassword: string;
  phone: string;
  linkedin: string;
  github: string;
  portfolioUrl: string;
  education: EducationEntry[];
  careers: CareerEntry[];
  prefSponsorship: boolean;
  prefVeteranFriendly: boolean;
  prefDisabilityFriendly: boolean;
  demographicHispanic: string;
  demographicRaceEthnicity: string;
  demographicDisability: string;
  demographicMilitaryStatus: string;
  sponsorship: string;
  immigrationStatus: string;
  resumeFolderUrl: string;
  updatedAt: string;
};

function pickAllowed(value: unknown, allowed: Set<string>): string {
  const s = asText(value).trim();
  return allowed.has(s) ? s : '';
}

function normMonth(m: unknown): string {
  const s = asText(m).trim();
  if (!s) return '';
  const n = parseInt(s, 10);
  if (n >= 1 && n <= 12) return String(n);
  return '';
}

function normYear(y: unknown): string {
  const s = asText(y).trim();
  return /^\d{4}$/.test(s) ? s : '';
}

function normalizeAge(raw: unknown): string {
  return asText(raw).trim().replace(/\D/g, '').slice(0, 3);
}

function asEntry(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeEducationEntries(arr: unknown): EducationEntry[] {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, MAX_EDUCATION).map((raw) => {
    const e = asEntry(raw);
    return {
      school: asText(e.school).trim(),
      diploma: asText(e.diploma).trim(),
      startMonth: normMonth(e.startMonth),
      startYear: normYear(e.startYear),
      endMonth: normMonth(e.endMonth),
      endYear: normYear(e.endYear),
    };
  });
}

function normalizeCareerEntries(arr: unknown): CareerEntry[] {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, MAX_CAREERS).map((raw) => {
    const c = asEntry(raw);
    const endPresent =
      !!c.endPresent || asText(c.endMonth).trim().toLowerCase() === 'present';
    return {
      company: asText(c.company).trim(),
      title: asText(c.title).trim(),
      description: asText(c.description).trim().slice(0, 2000),
      startMonth: normMonth(c.startMonth),
      startYear: normYear(c.startYear),
      endPresent,
      endMonth: endPresent ? '' : normMonth(c.endMonth),
      endYear: endPresent ? '' : normYear(c.endYear),
    };
  });
}

/** Normalize client PUT body into a stored autoBidProfile shape. */
export function normalizeAutoBidProfile(
  body: Record<string, unknown>,
): NormalizedAutoBidProfile {
  const g = asText(body.gender).trim();
  const gender = ALLOWED_GENDER.has(g) ? g : '';
  const so = asText(body.sexualOrientation).trim();
  const sexualOrientation = ALLOWED_SEXUAL_ORIENTATION.has(so) ? so : '';
  const defaultProvider =
    body.defaultProvider === 'openai' || body.defaultProvider === 'deepseek'
      ? body.defaultProvider
      : '';

  return {
    fullName: asText(body.fullName).trim(),
    firstName: asText(body.firstName).trim(),
    lastName: asText(body.lastName).trim(),
    age: normalizeAge(body.age),
    address: asText(body.address).trim(),
    city: asText(body.city).trim(),
    state: asText(body.state).trim(),
    country: asText(body.country).trim(),
    zipCode: asText(body.zipCode).trim(),
    desiredSalary: asText(body.desiredSalary).trim().slice(0, 64),
    gender,
    pronouns: pickAllowed(body.pronouns, ALLOWED_PRONOUNS),
    sexualOrientation,
    email: asText(body.email).trim(),
    gmailAppPassword: asText(body.gmailAppPassword).trim().slice(0, 128),
    openaiApiKey: asText(body.openaiApiKey).trim().slice(0, 256),
    deepseekApiKey: asText(body.deepseekApiKey).trim().slice(0, 256),
    defaultProvider,
    defaultModel: asText(body.defaultModel).trim().slice(0, 64),
    defaultPassword: asText(body.defaultPassword).trim().slice(0, 256),
    phone: asText(body.phone).trim(),
    linkedin: asText(body.linkedin).trim(),
    github: asText(body.github).trim(),
    portfolioUrl: asText(body.portfolioUrl).trim(),
    education: normalizeEducationEntries(body.education),
    careers: normalizeCareerEntries(body.careers),
    prefSponsorship: !!body.prefSponsorship,
    prefVeteranFriendly: !!body.prefVeteranFriendly,
    prefDisabilityFriendly: !!body.prefDisabilityFriendly,
    demographicHispanic: pickAllowed(
      body.demographicHispanic,
      ALLOWED_YES_NO_DECLINE,
    ),
    demographicRaceEthnicity: pickAllowed(
      body.demographicRaceEthnicity,
      ALLOWED_RACE,
    ),
    demographicDisability: pickAllowed(
      body.demographicDisability,
      ALLOWED_YES_NO_DECLINE,
    ),
    demographicMilitaryStatus: pickAllowed(
      body.demographicMilitaryStatus,
      ALLOWED_VETERAN,
    ),
    sponsorship: pickAllowed(body.sponsorship, ALLOWED_YES_NO_DECLINE),
    immigrationStatus: pickAllowed(
      body.immigrationStatus,
      ALLOWED_IMMIGRATION_STATUS,
    ),
    resumeFolderUrl: asText(body.resumeFolderUrl).trim(),
    updatedAt: new Date().toISOString(),
  };
}

/** Strip server-managed keys so a full Save cannot clobber dedicated endpoints. */
export function withoutServerManagedFields(
  profile: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(profile).filter(
      ([field]) => !SERVER_MANAGED_PROFILE_FIELDS.has(field),
    ),
  );
}
