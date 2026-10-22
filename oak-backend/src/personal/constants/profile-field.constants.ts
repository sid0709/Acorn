/** Allowed enum values for auto-bid profile fields (Athens-server contract). */

export const ALLOWED_GENDER = new Set([
  '',
  'prefer_not_say',
  'female',
  'male',
  'non_binary',
  'other',
]);

export const ALLOWED_PRONOUNS = new Set([
  '',
  'prefer_not_say',
  'she/her',
  'he/him',
  'they/them',
  'she/they',
  'he/they',
  'xe/xem',
  'ze/hir',
  'other',
]);

export const ALLOWED_SEXUAL_ORIENTATION = new Set([
  '',
  'prefer_not_say',
  'heterosexual',
  'gay',
  'lesbian',
  'bisexual',
  'pansexual',
  'asexual',
  'other',
]);

export const ALLOWED_YES_NO_DECLINE = new Set([
  '',
  'prefer_not_say',
  'yes',
  'no',
]);

export const ALLOWED_VETERAN = new Set([
  '',
  'prefer_not_say',
  'protected',
  'not_protected',
]);

export const ALLOWED_RACE = new Set([
  '',
  'prefer_not_say',
  'american_indian_alaska_native',
  'asian',
  'black',
  'native_hawaiian',
  'white',
  'two_or_more',
  'other',
]);

export const ALLOWED_IMMIGRATION_STATUS = new Set([
  '',
  'prefer_not_say',
  'us_citizen',
  'permanent_resident',
  'work_visa',
  'requires_sponsorship',
]);

export const MAX_EDUCATION = 15;
export const MAX_CAREERS = 25;

/** Not overwritten by full-profile Save (dedicated default-model / identity refresh). */
export const SERVER_MANAGED_PROFILE_FIELDS = new Set([
  'defaultProvider',
  'defaultModel',
  'resumeUpdatedAt',
]);

/** Secret fields encrypted at rest (Athens-server autoBidProfileSecrets). */
export const PROFILE_SECRET_FIELDS = [
  'openaiApiKey',
  'deepseekApiKey',
  'gmailPassword',
  'gmailAppPassword',
  'defaultPassword',
] as const;

export type ProfileSecretField = (typeof PROFILE_SECRET_FIELDS)[number];

export const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
