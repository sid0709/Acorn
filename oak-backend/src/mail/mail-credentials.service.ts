import { Injectable } from '@nestjs/common';
import { AccountInfoService } from '../auth/account-info.service';
import { asText } from '../personal/mappers/as-text';
import { ProfileSecretsService } from '../personal/secrets/profile-secrets.service';
import { BETA_TIER } from './constants/mail.constants';

export type MailCredentialsOk = {
  ok: true;
  email: string;
  password: string;
  applierName: string;
  profileId: string;
  tier: string | null;
};

export type MailCredentialsErr = {
  ok: false;
  error: string;
};

@Injectable()
export class MailCredentialsService {
  constructor(
    private readonly accounts: AccountInfoService,
    private readonly secrets: ProfileSecretsService,
  ) {}

  async resolve(
    applierName: string,
  ): Promise<MailCredentialsOk | MailCredentialsErr> {
    const acc = await this.accounts.findByName(applierName);
    if (!acc) {
      return { ok: false, error: `No account named "${applierName}".` };
    }
    const profile =
      acc.autoBidProfile &&
      typeof acc.autoBidProfile === 'object' &&
      !Array.isArray(acc.autoBidProfile)
        ? { ...(acc.autoBidProfile as Record<string, unknown>) }
        : {};
    const { profile: decrypted, unavailableFields } =
      this.secrets.decryptForClient(profile);
    const email = asText(decrypted.email).trim();
    const password = asText(decrypted.gmailAppPassword).replace(/\s/g, '');
    if (unavailableFields.includes('gmailAppPassword')) {
      return {
        ok: false,
        error:
          'The stored Gmail app password cannot be decrypted here. Re-enter it in Settings → Profile.',
      };
    }
    if (!email || !password) {
      return {
        ok: false,
        error: 'Configure Gmail email and app password in Settings → Profile.',
      };
    }
    return {
      ok: true,
      email,
      password,
      applierName: acc.name,
      profileId: acc.id,
      tier: acc.tier ?? null,
    };
  }

  isBeta(tier: string | null | undefined): boolean {
    return (
      String(tier ?? '')
        .trim()
        .toLowerCase() === BETA_TIER
    );
  }
}
