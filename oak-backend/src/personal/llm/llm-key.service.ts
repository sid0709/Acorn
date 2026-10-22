import { Injectable } from '@nestjs/common';
import { isDeepSeekModel, listOpenAiModels } from '@nextoffer/shared/models';
import {
  DEEPSEEK_CHAT_MODELS,
  DEEPSEEK_DEFAULT_MODEL,
  listDeepSeekModels,
  normalizeDeepSeekModel,
} from '../constants/deepseek-models.constants';
import {
  getLlmProvider,
  type LlmProviderId,
} from '../constants/llm-providers.constants';
import { asText } from '../mappers/as-text';

const MODEL_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class LlmKeyService {
  private readonly modelCache = new Map<
    string,
    { at: number; models: string[] }
  >();

  isModelCompatible(provider: LlmProviderId, model: string): boolean {
    const modelId = asText(model).trim();
    if (!modelId) return false;
    if (provider === 'deepseek') {
      const normalized = normalizeDeepSeekModel(modelId);
      return (
        isDeepSeekModel(normalized) || DEEPSEEK_CHAT_MODELS.includes(normalized)
      );
    }
    return !isDeepSeekModel(modelId);
  }

  async listModels(
    provider: LlmProviderId,
    apiKey: string,
    force = false,
  ): Promise<string[]> {
    const p = getLlmProvider(provider);
    if (!apiKey) throw new Error(`No API key configured for ${p.label}.`);

    if (p.id === 'deepseek') {
      const cacheKey = `${p.id}:${apiKey.slice(-12)}`;
      const cached = this.modelCache.get(cacheKey);
      if (!force && cached && Date.now() - cached.at < MODEL_TTL_MS) {
        return cached.models;
      }
      try {
        const models = await listDeepSeekModels(apiKey);
        const merged = uniqueModels([
          ...DEEPSEEK_CHAT_MODELS,
          ...models.map(normalizeDeepSeekModel),
        ]);
        this.modelCache.set(cacheKey, { at: Date.now(), models: merged });
        return merged;
      } catch {
        return [...DEEPSEEK_CHAT_MODELS];
      }
    }

    if (Array.isArray(p.models)) return p.models;

    const cacheKey = `${p.id}:${apiKey.slice(-12)}`;
    const cached = this.modelCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.at < MODEL_TTL_MS) {
      return cached.models;
    }

    const catalog = await listOpenAiModels(apiKey);
    const models = catalog
      .map((m) => asText(m.id))
      .filter(Boolean)
      .sort();
    this.modelCache.set(cacheKey, { at: Date.now(), models });
    return models;
  }

  async verifyKey(input: {
    provider: LlmProviderId;
    apiKey: string;
    model?: string;
  }): Promise<{ ok: boolean; status: number; message: string }> {
    const p = getLlmProvider(input.provider);
    const apiKey = asText(input.apiKey).trim();
    if (!apiKey) {
      return {
        ok: false,
        status: 400,
        message: `No ${p.label} API key provided.`,
      };
    }

    try {
      if (p.id === 'openai') {
        const catalog = await listOpenAiModels(apiKey);
        const requested = asText(input.model).trim();
        if (requested && !catalog.some((entry) => entry.id === requested)) {
          return {
            ok: false,
            status: 400,
            message: `${requested} is not available to this OpenAI API key.`,
          };
        }
        return {
          ok: true,
          status: 200,
          message: `${p.label} key is valid.`,
        };
      }

      const catalog = await listDeepSeekModels(apiKey);
      const requested = normalizeDeepSeekModel(
        asText(input.model).trim() || DEEPSEEK_DEFAULT_MODEL,
      );
      if (
        asText(input.model).trim() &&
        catalog.length > 0 &&
        !catalog.includes(requested) &&
        !DEEPSEEK_CHAT_MODELS.includes(requested)
      ) {
        return {
          ok: false,
          status: 400,
          message: `${requested} is not available to this DeepSeek API key.`,
        };
      }
      return {
        ok: true,
        status: 200,
        message: `${p.label} key is valid.`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        status: 0,
        message: `Could not validate ${p.label} key: ${message}`,
      };
    }
  }
}

function uniqueModels(ids: string[]): string[] {
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
}
