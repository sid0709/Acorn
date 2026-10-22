import type { ChatMessage } from './openai.types';

/** Size stats for LLM requests — never include prompt text or API keys. */
export function llmMessageStats(messages: ChatMessage[] | undefined) {
  const list = Array.isArray(messages) ? messages : [];
  return {
    messageCount: list.length,
    promptChars: list.reduce(
      (sum, message) => sum + String(message?.content || '').length,
      0,
    ),
  };
}

export function compactError(err: unknown, max = 240): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.length <= max ? raw : `${raw.slice(0, max)}…`;
}
