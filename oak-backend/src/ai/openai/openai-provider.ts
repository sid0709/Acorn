import { deepseekThinkingBody } from './deepseek';
import { normalizeDeepSeekModel } from '../../personal/constants/deepseek-models.constants';
import type { ChatCompletionInput } from './openai.types';

export const PROVIDER_BASE: Record<'openai' | 'deepseek', string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
};

export function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error('LLM request aborted'), { name: 'AbortError' });
}

export function timeoutError(timeoutMs: number): Error {
  return Object.assign(
    new Error(`LLM request timed out after ${timeoutMs}ms`),
    { name: 'TimeoutError', retryable: true },
  );
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

const REASONING_EFFORTS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

/**
 * GPT-5 / GPT-6 / o-series Chat Completions `reasoning_effort`.
 * Empty / "default" → low so generate does not sit on medium thinking.
 * GPT-6 keeps `none` as `none` (required for Chat Completions function calling).
 * GPT-5 maps `none` → `minimal`.
 */
export function openaiReasoningEffort(
  model: string,
  requested?: string,
): string | null {
  if (!openaiModelRejectsTemperature(model)) return null;
  const raw = String(requested || '')
    .trim()
    .toLowerCase();
  if (!raw || raw === 'default') return 'low';
  if (raw === 'none') {
    return String(model || '')
      .trim()
      .toLowerCase()
      .startsWith('gpt-6')
      ? 'none'
      : 'minimal';
  }
  return REASONING_EFFORTS.has(raw) ? raw : 'low';
}

export function resolveResponseFormat(
  provider: 'openai' | 'deepseek',
  input: ChatCompletionInput,
): Record<string, unknown> | null {
  if (input.jsonSchema && provider === 'openai') {
    return {
      type: 'json_schema',
      json_schema: {
        name: input.jsonSchema.name,
        strict: input.jsonSchema.strict !== false,
        schema: input.jsonSchema.schema,
      },
    };
  }
  if (input.jsonSchema || input.jsonMode) {
    return { type: 'json_object' };
  }
  return null;
}

/** GPT-5 / GPT-6 / o-series chat models reject a custom temperature (only the default is allowed). */
export function openaiModelRejectsTemperature(model: string): boolean {
  const m = String(model || '')
    .trim()
    .toLowerCase();
  return (
    m.startsWith('gpt-5') ||
    m.startsWith('gpt-6') ||
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4')
  );
}

/** Build OpenAI-compatible chat body (DeepSeek: normalize model + thinking). */
export function buildChatCompletionBody(
  provider: 'openai' | 'deepseek',
  input: ChatCompletionInput,
  extras?: { stream?: boolean },
): Record<string, unknown> {
  const model =
    provider === 'deepseek' ? normalizeDeepSeekModel(input.model) : input.model;
  const responseFormat = resolveResponseFormat(provider, input);
  const includeTemperature =
    typeof input.temperature === 'number' &&
    (provider !== 'openai' || !openaiModelRejectsTemperature(model));
  const body: Record<string, unknown> = {
    model,
    messages: input.messages,
    ...(extras?.stream ? { stream: true } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(includeTemperature ? { temperature: input.temperature } : {}),
  };
  if (provider === 'deepseek') {
    Object.assign(
      body,
      deepseekThinkingBody({
        jsonMode: input.jsonMode,
        jsonSchema: input.jsonSchema,
        thinking: input.thinking,
      }),
    );
  } else {
    const effort = openaiReasoningEffort(model, input.reasoningEffort);
    if (effort) body.reasoning_effort = effort;
  }
  if (extras?.stream && provider === 'openai') {
    body.stream_options = { include_usage: true };
  }
  return body;
}
