export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
export const DEEPSEEK_ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
/** Official Chat Completions IDs. `deepseek-flash` is DeepSeek-V4.1-Flash. */
export const DEEPSEEK_MODELS = ['deepseek-flash', 'deepseek-v4-pro'];
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-flash';

export function isDeepSeekModel(id) {
  return /^deepseek/i.test(String(id || ''));
}

/** Retired / casual IDs → current API model IDs. */
const MODEL_ALIASES = {
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
  'deepseek-flash-v4': 'deepseek-flash',
  'deepseek-v4.1-flash': 'deepseek-flash',
  'deepseek-v4.1': 'deepseek-flash',
  'deepseek-v4': 'deepseek-flash',
  'deepseek-chat': 'deepseek-flash',
  'deepseek-reasoner': 'deepseek-flash',
  'deepseek-coder': 'deepseek-flash',
  'v4.1-flash': 'deepseek-flash',
  'v4-flash': 'deepseek-flash',
  'flash-v4': 'deepseek-flash',
  'deepseek-pro-v4': 'deepseek-v4-pro',
  'deepseek-v4pro': 'deepseek-v4-pro',
  'v4-pro': 'deepseek-v4-pro',
  'pro-v4': 'deepseek-v4-pro',
};

/**
 * Map profile / UI model strings onto DeepSeek's current API IDs.
 * Unknown `deepseek-*` strings pass through unchanged.
 */
export function normalizeDeepSeekModel(model) {
  const raw = String(model || '').trim();
  if (!raw) return DEEPSEEK_DEFAULT_MODEL;
  const key = raw.toLowerCase();
  if (MODEL_ALIASES[key]) return MODEL_ALIASES[key];
  return raw;
}

const SKIP = [
  'embedding',
  'tts',
  'whisper',
  'dall-e',
  'davinci',
  'babbage',
  'moderation',
  'transcribe',
  'realtime',
  'audio',
  'image',
  'sora',
  'computer-use',
];

function isChatModel(id) {
  const lower = id.toLowerCase();
  if (SKIP.some((s) => lower.includes(s))) return false;
  return /^(gpt-|o[134]|chatgpt)/.test(lower);
}

export async function listOpenAiModels(apiKey) {
  if (!apiKey) return [];
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI models ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.data || [])
    .filter((m) => isChatModel(m.id))
    .map((m) => ({ id: m.id, created: m.created, ownedBy: m.owned_by }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
