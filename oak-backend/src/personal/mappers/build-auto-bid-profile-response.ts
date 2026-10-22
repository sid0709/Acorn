import type { EducationEntry, CareerEntry } from './normalize-auto-bid-profile';
import { autoBidFullName } from '../lib/auto-bid-full-name';
import { asText } from './as-text';

function defaultEducationEntry(): EducationEntry {
  return {
    school: '',
    diploma: '',
    startMonth: '',
    startYear: '',
    endMonth: '',
    endYear: '',
  };
}

function defaultCareerEntry(): CareerEntry {
  return {
    company: '',
    title: '',
    description: '',
    startMonth: '',
    startYear: '',
    endMonth: '',
    endYear: '',
    endPresent: false,
  };
}

export type AutoBidProfileResponse = {
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
  companyCareer: string;
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
  updatedAt: string | null;
  resumeUpdatedAt: string | null;
};

/** Shape returned in GET `profile` (stored or empty). Matches Athens-server. */
export function buildAutoBidProfileResponse(
  p: Record<string, unknown>,
  accountName = '',
): AutoBidProfileResponse {
  const educationRaw = Array.isArray(p.education) ? p.education : [];
  const careersRaw = Array.isArray(p.careers) ? p.careers : [];
  const education = educationRaw.length
    ? (educationRaw as EducationEntry[])
    : [defaultEducationEntry()];
  const careers = careersRaw.length
    ? (careersRaw as CareerEntry[])
    : [defaultCareerEntry()];

  const storedFirstName = asText(p.firstName).trim();
  const storedLastName = asText(p.lastName).trim();
  const fullName = autoBidFullName(p, accountName);
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName = storedFirstName || nameParts[0] || '';
  const lastName = storedLastName || nameParts.slice(1).join(' ');

  return {
    fullName,
    firstName,
    lastName,
    age: p.age != null ? asText(p.age) : '',
    address: asText(p.address),
    city: asText(p.city),
    state: asText(p.state),
    country: asText(p.country),
    zipCode: asText(p.zipCode),
    desiredSalary: asText(p.desiredSalary),
    gender: asText(p.gender),
    pronouns: asText(p.pronouns),
    sexualOrientation: asText(p.sexualOrientation),
    email: asText(p.email),
    gmailAppPassword: asText(p.gmailAppPassword),
    openaiApiKey: asText(p.openaiApiKey),
    deepseekApiKey: asText(p.deepseekApiKey),
    defaultProvider: asText(p.defaultProvider),
    defaultModel: asText(p.defaultModel),
    defaultPassword: asText(p.defaultPassword),
    phone: asText(p.phone),
    linkedin: asText(p.linkedin),
    github: asText(p.github),
    portfolioUrl: asText(p.portfolioUrl),
    education,
    careers,
    companyCareer: asText(p.companyCareer),
    prefSponsorship: !!p.prefSponsorship,
    prefVeteranFriendly: !!p.prefVeteranFriendly,
    prefDisabilityFriendly: !!p.prefDisabilityFriendly,
    demographicHispanic: asText(p.demographicHispanic),
    demographicRaceEthnicity: asText(p.demographicRaceEthnicity),
    demographicDisability: asText(p.demographicDisability),
    demographicMilitaryStatus: asText(p.demographicMilitaryStatus),
    sponsorship: asText(p.sponsorship),
    immigrationStatus: asText(p.immigrationStatus),
    resumeFolderUrl: asText(p.resumeFolderUrl),
    updatedAt: asText(p.updatedAt) || null,
    resumeUpdatedAt: asText(p.resumeUpdatedAt) || null,
  };
}
