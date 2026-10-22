import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountInfoRepository } from '../../auth/account-info.repository';
import { AccountInfoService } from '../../auth/account-info.service';
import { OBJECT_ID_PATTERN } from '../constants/profile-field.constants';
import {
  DEEPSEEK_FALLBACK_MODELS,
  normalizeDeepSeekModel,
} from '../constants/deepseek-models.constants';
import {
  getLlmProvider,
  isLlmProviderId,
  type LlmProviderId,
} from '../constants/llm-providers.constants';
import { asText } from '../mappers/as-text';
import { ProfileSecretsService } from '../secrets/profile-secrets.service';
import { LlmKeyService } from './llm-key.service';

@Injectable()
export class PersonalLlmService {
  constructor(
    private readonly accounts: AccountInfoService,
    private readonly accountRepo: AccountInfoRepository,
    private readonly secrets: ProfileSecretsService,
    private readonly llmKeys: LlmKeyService,
  ) {}

  async listModels(input: {
    providerRaw?: string;
    applierName?: string;
    profileId?: string;
    force?: boolean;
  }) {
    const provider: LlmProviderId = isLlmProviderId(input.providerRaw)
      ? input.providerRaw
      : 'openai';
    const p = getLlmProvider(provider);
    if (Array.isArray(p.models)) {
      return { success: true, provider, models: p.models };
    }
    if (provider === 'deepseek') {
      try {
        const apiKey = await this.loadProviderApiKey(
          provider,
          input.applierName,
          input.profileId,
        );
        if (!apiKey) {
          return {
            success: true,
            provider,
            models: [...DEEPSEEK_FALLBACK_MODELS],
          };
        }
        const models = await this.llmKeys.listModels(
          provider,
          apiKey,
          Boolean(input.force),
        );
        return { success: true, provider, models };
      } catch {
        return {
          success: true,
          provider,
          models: [...DEEPSEEK_FALLBACK_MODELS],
        };
      }
    }

    try {
      const apiKey = await this.loadProviderApiKey(
        provider,
        input.applierName,
        input.profileId,
      );
      if (!apiKey) {
        return {
          success: true,
          provider,
          models: [] as string[],
          error: `No ${p.label} API key in profile.`,
        };
      }
      const models = await this.llmKeys.listModels(
        provider,
        apiKey,
        Boolean(input.force),
      );
      return { success: true, provider, models };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, models: [] as string[], error: message };
    }
  }

  async checkKey(body: Record<string, unknown>) {
    const provider: LlmProviderId = isLlmProviderId(body.provider)
      ? body.provider
      : 'openai';
    let apiKey = asText(body.apiKey).trim();
    if (!apiKey) {
      apiKey = await this.loadProviderApiKey(
        provider,
        asText(body.applierName),
        asText(body.profileId),
      );
    }
    const result = await this.llmKeys.verifyKey({ provider, apiKey });
    let models: string[] = [];
    if (result.ok) {
      try {
        models = await this.llmKeys.listModels(provider, apiKey);
      } catch {
        models = [];
      }
    }
    return { success: true, provider, models, ...result };
  }

  async setDefaultModel(body: Record<string, unknown>) {
    const name = asText(body.applierName).trim();
    const provider = isLlmProviderId(body.provider) ? body.provider : null;
    const rawModel = asText(body.model).trim().slice(0, 64);
    const model =
      provider === 'deepseek' ? normalizeDeepSeekModel(rawModel) : rawModel;

    if (!name) {
      throw new BadRequestException({
        success: false,
        error: 'applierName required',
        message: 'applierName required',
      });
    }
    if (!provider) {
      throw new BadRequestException({
        success: false,
        valid: false,
        error: 'provider must be openai or deepseek',
        message: 'provider must be openai or deepseek',
      });
    }
    if (!model) {
      throw new BadRequestException({
        success: false,
        valid: false,
        error: 'model required',
        message: 'model required',
      });
    }
    if (!this.llmKeys.isModelCompatible(provider, model)) {
      throw new BadRequestException({
        success: false,
        valid: false,
        error: `${model} is not a ${getLlmProvider(provider).label} model.`,
        message: `${model} is not a ${getLlmProvider(provider).label} model.`,
      });
    }

    const acc = await this.resolveAccount(name, asText(body.profileId));
    if (!acc) {
      throw new NotFoundException({
        success: false,
        error: `No account named "${name}".`,
        message: `No account named "${name}".`,
      });
    }

    const keyField = getLlmProvider(provider).keyField;
    const profile = this.secrets.decryptSelected(
      asProfileRecord(acc.autoBidProfile),
      [keyField],
    );
    const apiKey = asText(profile[keyField]).trim();
    if (!apiKey) {
      return {
        success: false,
        valid: false,
        error: `No ${getLlmProvider(provider).label} API key saved. Add it and save your profile first.`,
      };
    }

    const check = await this.llmKeys.verifyKey({ provider, apiKey, model });
    if (!check.ok) {
      return {
        success: false,
        valid: false,
        error:
          check.message || `${getLlmProvider(provider).label} key is invalid.`,
      };
    }

    await this.accountRepo.patchAutoBidProfileFields(acc.id, {
      defaultProvider: provider,
      defaultModel: model,
      updatedAt: new Date().toISOString(),
    });

    return {
      success: true,
      valid: true,
      provider,
      model,
      message: `Default set to ${provider} · ${model}`,
    };
  }

  private async loadProviderApiKey(
    provider: LlmProviderId,
    applierName?: string,
    profileId?: string,
  ): Promise<string> {
    const name = asText(applierName).trim();
    const id = asText(profileId).trim();
    if (!name && !id) return '';
    const acc = await this.resolveAccount(name, id);
    if (!acc) return '';
    const keyField = getLlmProvider(provider).keyField;
    const profile = this.secrets.decryptSelected(
      asProfileRecord(acc.autoBidProfile),
      [keyField],
    );
    return asText(profile[keyField]).trim();
  }

  private async resolveAccount(name: string, profileIdRaw?: string) {
    const profileId = asText(profileIdRaw).trim();
    if (profileId && OBJECT_ID_PATTERN.test(profileId)) {
      const byId = await this.accountRepo.findById(profileId);
      if (byId) return byId;
    }
    const trimmed = asText(name).trim();
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
