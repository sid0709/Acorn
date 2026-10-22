export type LlmProviderId = 'openai' | 'deepseek';

export type LlmProviderConfig = {
  id: LlmProviderId;
  label: string;
  keyField: 'openaiApiKey' | 'deepseekApiKey';
  /** Fixed catalog; null = fetch live (OpenAI / DeepSeek). */
  models: string[] | null;
};

export const LLM_PROVIDERS: Record<LlmProviderId, LlmProviderConfig> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keyField: 'openaiApiKey',
    models: null,
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    // null so LlmKeyService hits DeepSeek /models (falls back to flash / pro).
    keyField: 'deepseekApiKey',
    models: null,
  },
};

export function getLlmProvider(id: string): LlmProviderConfig {
  return LLM_PROVIDERS[id as LlmProviderId] || LLM_PROVIDERS.openai;
}

export function isLlmProviderId(value: unknown): value is LlmProviderId {
  return value === 'openai' || value === 'deepseek';
}
