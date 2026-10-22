import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AccountInfo, Prisma } from '@prisma/client';
import { AccountInfoRepository } from '../auth/account-info.repository';
import { AccountInfoService } from '../auth/account-info.service';
import { OBJECT_ID_PATTERN } from './constants/profile-field.constants';
import { asText } from './mappers/as-text';
import { buildAutoBidProfileResponse } from './mappers/build-auto-bid-profile-response';
import {
  normalizeAutoBidProfile,
  withoutServerManagedFields,
} from './mappers/normalize-auto-bid-profile';
import { ProfileSecretsService } from './secrets/profile-secrets.service';

@Injectable()
export class AutoBidProfileService {
  constructor(
    private readonly accounts: AccountInfoService,
    private readonly accountRepo: AccountInfoRepository,
    private readonly secrets: ProfileSecretsService,
  ) {}

  async get(applierNameRaw: string, profileIdRaw?: string) {
    const name = asText(applierNameRaw).trim();
    if (!name) {
      throw new BadRequestException({
        success: false,
        error: 'applierName query required',
        message: 'applierName query required',
      });
    }

    const acc = await this.resolveAccount(name, profileIdRaw);
    if (!acc) {
      return {
        success: true,
        accountExists: false,
        vendorAllowed: false,
        vendorPasswordSet: false,
        profile: buildAutoBidProfileResponse({}, name),
      };
    }

    const stored = asProfileRecord(acc.autoBidProfile);
    const { profile, unavailableFields } =
      this.secrets.decryptForClient(stored);

    return {
      success: true,
      accountExists: true,
      vendorAllowed: Boolean(acc.vendorAllowed),
      vendorPasswordSet: Boolean(acc.vendorPassword),
      secretFieldsUnavailable: unavailableFields,
      profile: buildAutoBidProfileResponse(profile, acc.name),
    };
  }

  async upsert(body: Record<string, unknown>) {
    const name = asText(body.applierName).trim();
    if (!name) {
      throw new BadRequestException({
        success: false,
        error: 'applierName required in body',
        message: 'applierName required in body',
      });
    }

    const profileId = asText(body.profileId).trim();
    const acc = await this.resolveAccount(name, profileId || undefined);
    if (!acc) {
      throw new NotFoundException({
        success: false,
        error: `No account named "${name}". Add it under Applier accounts in the sidebar (or POST /api/account_info) before saving the profile.`,
        message: `No account named "${name}".`,
      });
    }

    const stored = asProfileRecord(acc.autoBidProfile);
    const { profile: existing, unavailableFields } =
      this.secrets.decryptForClient(stored);

    const normalized = this.secrets.preserveUnavailable(
      normalizeAutoBidProfile(body),
      stored,
      unavailableFields,
    );
    const encryptedProfile = this.secrets.encryptProfile(normalized);
    const editable = withoutServerManagedFields(encryptedProfile);
    const merged: Record<string, unknown> = {
      ...stored,
      ...editable,
      defaultProvider: stored.defaultProvider ?? existing.defaultProvider ?? '',
      defaultModel: stored.defaultModel ?? existing.defaultModel ?? '',
      resumeUpdatedAt:
        stored.resumeUpdatedAt ?? existing.resumeUpdatedAt ?? null,
    };

    const vendorAllowed =
      body.vendorAllowed === true || body.vendorAllowed === 'true';

    await this.accountRepo.updateAutoBidProfile(
      acc.id,
      merged as Prisma.InputJsonValue,
      vendorAllowed,
    );

    const clientProfile = this.secrets.decryptForClient({
      ...encryptedProfile,
      defaultProvider: existing.defaultProvider || '',
      defaultModel: existing.defaultModel || '',
      resumeUpdatedAt: existing.resumeUpdatedAt || null,
    });

    return {
      success: true,
      profile: clientProfile.profile,
      secretFieldsUnavailable: clientProfile.unavailableFields,
      vendorAllowed,
    };
  }

  private async resolveAccount(
    name: string,
    profileIdRaw?: string,
  ): Promise<AccountInfo | null> {
    const profileId = asText(profileIdRaw).trim();
    if (profileId && OBJECT_ID_PATTERN.test(profileId)) {
      const byId = await this.accountRepo.findById(profileId);
      if (byId) return byId;
    }
    return this.accounts.findByName(name);
  }
}

function asProfileRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}
