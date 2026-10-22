import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountInfoRepository } from '../../auth/account-info.repository';
import { AccountInfoService } from '../../auth/account-info.service';
import {
  DEEPSEEK_DEFAULT_MODEL,
  normalizeDeepSeekModel,
} from '../../personal/constants/deepseek-models.constants';
import {
  getLlmProvider,
  isLlmProviderId,
  type LlmProviderId,
} from '../../personal/constants/llm-providers.constants';
import { OBJECT_ID_PATTERN } from '../../personal/constants/profile-field.constants';
import { asText } from '../../personal/mappers/as-text';
import { ProfileSecretsService } from '../../personal/secrets/profile-secrets.service';

export type ProfileLlmAuth = {
  profileId: string;
  applierName: string;
  provider: LlmProviderId;
  model: string;
  apiKey: string;
};

/**
 * Resolve signed-in profile's decrypted LLM key + default model.
 * Used by Review Title / AI Analyze sessions (not a server env key).
 */
@Injectable()
export class ProfileLlmAuthService {
  constructor(
    private readonly accounts: AccountInfoService,
    private readonly accountRepo: AccountInfoRepository,
    private readonly secrets: ProfileSecretsService,
  ) {}

  async resolve(input: {
    applierName?: string;
    profileId?: string;
    provider?: string;
    model?: string;
  }): Promise<ProfileLlmAuth> {
    const acc = await this.resolveAccount(
      asText(input.applierName),
      asText(input.profileId),
    );
    if (!acc) {
      throw new NotFoundException({
        success: false,
        message: 'Account not found for LLM auth.',
        error: 'Account not found for LLM auth.',
      });
    }

    const profile = asProfileRecord(acc.autoBidProfile);
    const providerRaw =
      asText(input.provider).trim() ||
      asText(profile.defaultProvider).trim() ||
      'openai';
    const provider: LlmProviderId = isLlmProviderId(providerRaw)
      ? providerRaw
      : 'openai';
    const p = getLlmProvider(provider);
    const rawModel =
      asText(input.model).trim() ||
      asText(profile.defaultModel).trim() ||
      (provider === 'openai' ? 'gpt-4o-mini' : DEEPSEEK_DEFAULT_MODEL);
    const model =
      provider === 'deepseek' ? normalizeDeepSeekModel(rawModel) : rawModel;

    const decrypted = this.secrets.decryptSelected(profile, [p.keyField]);
    const apiKey = asText(decrypted[p.keyField]).trim();
    if (!apiKey) {
      throw new BadRequestException({
        success: false,
        message: `No ${p.label} API key in profile. Add it in Settings and save first.`,
        error: `No ${p.label} API key in profile.`,
      });
    }

    return {
      profileId: acc.id,
      applierName: acc.name,
      provider,
      model,
      apiKey,
    };
  }

  private async resolveAccount(name: string, profileIdRaw: string) {
    const profileId = profileIdRaw.trim();
    if (profileId && OBJECT_ID_PATTERN.test(profileId)) {
      const byId = await this.accountRepo.findById(profileId);
      if (byId) return byId;
    }
    const trimmed = name.trim();
    if (!trimmed) return null;
    return this.accounts.findByName(trimmed);
  }
}

function asProfileRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}
