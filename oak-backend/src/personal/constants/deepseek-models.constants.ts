import {
  DEEPSEEK_DEFAULT_MODEL as SHARED_DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_MODELS,
  normalizeDeepSeekModel as sharedNormalizeDeepSeekModel,
} from '@nextoffer/shared/models';

/** Official Chat Completions models (DeepSeek-V4.1-Flash + V4-Pro). */
export const DEEPSEEK_CHAT_MODELS = [...DEEPSEEK_MODELS] as const;

export const DEEPSEEK_DEFAULT_MODEL = SHARED_DEEPSEEK_DEFAULT_MODEL;

/** Static fallback when DeepSeek /models is unreachable. */
export const DEEPSEEK_FALLBACK_MODELS = [...DEEPSEEK_CHAT_MODELS];

export const normalizeDeepSeekModel = sharedNormalizeDeepSeekModel;

export async function listDeepSeekModels(apiKey: string): Promise<string[]> {
  const res = await fetch('https://api.deepseek.com/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`DeepSeek models ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    data?: Array<{ id?: string }>;
  };
  const ids = (data.data || [])
    .map((m) => sharedNormalizeDeepSeekModel(String(m.id || '').trim()))
    .filter(Boolean)
    .sort();
  return ids.length ? [...new Set(ids)] : [...DEEPSEEK_CHAT_MODELS];
}
