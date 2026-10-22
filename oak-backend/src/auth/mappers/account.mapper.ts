import type { AccountInfo } from '@prisma/client';

export type AuthUserView = {
  _id: string;
  name: string;
  tier: string | null;
  permission: string | null;
};

const SECRET_PROFILE_FIELDS = [
  'openaiApiKey',
  'deepseekApiKey',
  'gmailPassword',
  'gmailAppPassword',
  'defaultPassword',
] as const;

export function toAuthUser(account: AccountInfo): AuthUserView {
  return {
    _id: account.id,
    name: account.name,
    tier: account.tier ?? null,
    permission: account.permission ?? null,
  };
}

/** Strip secrets before returning account docs to Athens clients. */
export function sanitizeAccount(account: AccountInfo): Record<string, unknown> {
  const safe: Record<string, unknown> = { ...account, _id: account.id };
  delete safe.id;
  delete safe.password;
  delete safe.vendorPassword;

  if (safe.notionIntegration && typeof safe.notionIntegration === 'object') {
    const notion = { ...(safe.notionIntegration as Record<string, unknown>) };
    delete notion.accessToken;
    safe.notionIntegration = notion;
  }

  if (safe.autoBidProfile && typeof safe.autoBidProfile === 'object') {
    const profile = { ...(safe.autoBidProfile as Record<string, unknown>) };
    for (const field of ['openaiApiKey', 'deepseekApiKey'] as const) {
      profile[`${field}Configured`] = Boolean(profile[field]);
    }
    for (const field of SECRET_PROFILE_FIELDS) {
      delete profile[field];
    }
    safe.autoBidProfile = profile;
  }

  return safe;
}
