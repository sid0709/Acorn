import { parsePromptUsage } from '../../ai-usage/lib/pricing';
import type { ChatUsage } from './openai.types';

/** Map an OpenAI/DeepSeek `usage` object onto ChatUsage, including cache hits. */
export function parseChatUsage(usage: unknown): ChatUsage | null {
  if (!usage || typeof usage !== 'object') return null;
  const parsed = parsePromptUsage(usage as Record<string, unknown>);
  const promptTokens = parsed.cacheMiss + parsed.cacheHit;
  return {
    promptTokens,
    completionTokens: parsed.outputTokens,
    totalTokens: parsed.totalTokens || promptTokens + parsed.outputTokens,
    cachedTokens: parsed.cacheHit,
  };
}
