import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountInfoService } from '../../auth/account-info.service';
import { cleanString } from './lib/clean-string';
import { defaultGeneratorConfig } from './lib/default-generator-config';
import {
  identityFromProfile,
  profileHasIdentity,
} from './lib/identity-from-profile';
import { migrateGeneratorConfig } from './lib/migrate-generator-config';
import { persistedGenerationRequest } from './lib/persisted-generation-request';
import type { StoredGeneratorConfig } from './lib/persisted-generation-request';
import { ResumeGeneratorConfigService } from './resume-generator-config.service';

export type HydratedGeneration = {
  applierName: string;
  profileId: string;
  request: ReturnType<typeof persistedGenerationRequest>;
};

@Injectable()
export class ResumeGenerateHydrateService {
  constructor(
    private readonly accounts: AccountInfoService,
    private readonly configs: ResumeGeneratorConfigService,
  ) {}

  async hydrate(input: {
    applierName: string;
    profileId?: string;
    jobDescription: string;
    jobSkills?: string[] | null;
    parentJobId?: string | null;
  }): Promise<HydratedGeneration> {
    const applierName = cleanString(input.applierName);
    const jobDescription = cleanString(input.jobDescription);
    if (!applierName) {
      throw new BadRequestException({
        success: false,
        error: 'applierName is required',
      });
    }
    if (!jobDescription) {
      throw new BadRequestException({
        success: false,
        error: 'jobDescription is required',
      });
    }

    const account = await this.accounts.findByName(applierName);
    if (!account) {
      throw new BadRequestException({
        success: false,
        error: 'Account not found.',
      });
    }
    const profile =
      account.autoBidProfile &&
      typeof account.autoBidProfile === 'object' &&
      !Array.isArray(account.autoBidProfile)
        ? (account.autoBidProfile as Record<string, unknown>)
        : {};
    if (!profileHasIdentity(profile)) {
      throw new BadRequestException({
        success: false,
        error: 'Load your saved career profile before generating.',
      });
    }

    const stored = await this.configs.get(account.name || applierName);
    const config: StoredGeneratorConfig = stored.config
      ? (migrateGeneratorConfig(stored.config).config as StoredGeneratorConfig)
      : defaultGeneratorConfig();
    const identity = identityFromProfile(profile);
    const profileId =
      cleanString(input.profileId) ||
      account.id ||
      applierName.toLocaleLowerCase('en-US');

    return {
      applierName: account.name || applierName,
      profileId,
      request: persistedGenerationRequest({
        applierName: account.name || applierName,
        profileId,
        config,
        identity,
        jobDescription,
        jobSkills: input.jobSkills,
        parentJobId: input.parentJobId,
      }),
    };
  }
}
