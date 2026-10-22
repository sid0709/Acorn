import { Injectable } from '@nestjs/common';
import { appLogger } from '../../common/logger/app-logger';
import { LLM_CHAT_TIMEOUT_MS } from '../constants/ai-concurrency.constants';
import { compactError, llmMessageStats } from './llm-log-fields';
import {
  abortError,
  buildChatCompletionBody,
  isRetryableStatus,
  PROVIDER_BASE,
  timeoutError,
} from './openai-provider';
import { parseChatUsage } from './parse-chat-usage';
import type {
  ChatCompletionInput,
  ChatCompletionResult,
  ChatStreamEvent,
} from './openai.types';

/**
 * OpenAI-compatible streaming chat (OpenAI + DeepSeek).
 * Yields `delta` tokens then a final `done` with usage/timing.
 */
@Injectable()
export class OpenAiChatStreamService {
  private readonly log = appLogger(OpenAiChatStreamService.name);

  async *chatCompletionStream(
    input: ChatCompletionInput,
  ): AsyncGenerator<ChatStreamEvent> {
    const provider = input.provider ?? 'openai';
    const base = PROVIDER_BASE[provider] ?? PROVIDER_BASE.openai;
    const timeoutMs = input.timeoutMs ?? LLM_CHAT_TIMEOUT_MS;
    const body = buildChatCompletionBody(provider, input, { stream: true });
    const stats = llmMessageStats(input.messages);

    if (input.signal?.aborted) throw abortError(input.signal);

    this.log.debug(
      {
        provider,
        model: input.model,
        jsonMode: Boolean(input.jsonMode),
        timeoutMs,
        ...stats,
      },
      'LLM stream start',
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onOuterAbort, { once: true });

    const startedAt = Date.now();
    let ttftMs: number | null = null;
    let billedModel = typeof body.model === 'string' ? body.model : input.model;
    let usage: ChatCompletionResult['usage'] = null;
    let deltaChars = 0;

    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(
          `LLM HTTP ${res.status}: ${text.slice(0, 400)}`,
        ) as Error & { retryable?: boolean; status?: number };
        err.status = res.status;
        err.retryable = isRetryableStatus(res.status);
        throw err;
      }
      if (!res.body) {
        throw Object.assign(new Error('LLM returned an empty stream body'), {
          retryable: true,
        });
      }

      yield* readProviderSse(res.body, input.signal, {
        onDelta: (text) => {
          if (ttftMs == null) ttftMs = Date.now() - startedAt;
          deltaChars += text.length;
          return text;
        },
        onMeta: (meta) => {
          if (meta.model) billedModel = meta.model;
          if (meta.usage) usage = meta.usage;
        },
      });

      const durationMs = Date.now() - startedAt;
      this.log.info(
        {
          provider,
          model: input.model,
          billedModel,
          durationMs,
          ttftMs,
          deltaChars,
          usage,
          ...stats,
        },
        'LLM stream ok',
      );

      yield {
        type: 'done',
        model: billedModel,
        usage,
        durationMs,
        ttftMs,
      };
    } catch (err) {
      const aborted = Boolean(input.signal?.aborted);
      const timedOut = controller.signal.aborted && !aborted;
      const payload = {
        provider,
        model: input.model,
        durationMs: Date.now() - startedAt,
        ttftMs,
        aborted,
        timedOut,
        errName: err instanceof Error ? err.name : typeof err,
        err: compactError(err),
        ...stats,
      };
      if (aborted) this.log.warn(payload, 'LLM stream aborted');
      else if (timedOut) this.log.error(payload, 'LLM stream timed out');
      else this.log.error(payload, 'LLM stream failed');
      if (input.signal?.aborted) throw abortError(input.signal);
      if (controller.signal.aborted) throw timeoutError(timeoutMs);
      throw err;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onOuterAbort);
    }
  }
}

type StreamMeta = {
  model?: string;
  usage?: ChatCompletionResult['usage'];
};

async function* readProviderSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  hooks: {
    onDelta: (text: string) => string;
    onMeta: (meta: StreamMeta) => void;
  },
): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    if (signal?.aborted) throw abortError(signal);
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let parsed: {
        model?: string;
        usage?: Record<string, unknown>;
        error?: { message?: string } | string;
        choices?: Array<{ delta?: { content?: string }; text?: string }>;
      };
      try {
        parsed = JSON.parse(payload) as typeof parsed;
      } catch {
        continue;
      }
      if (parsed.error) {
        const msg =
          typeof parsed.error === 'string'
            ? parsed.error
            : parsed.error.message;
        throw new Error(msg || 'LLM stream failed');
      }
      const meta: StreamMeta = {};
      if (parsed.model) meta.model = parsed.model;
      if (parsed.usage) {
        meta.usage = parseChatUsage(parsed.usage) ?? undefined;
      }
      if (meta.model || meta.usage) hooks.onMeta(meta);
      const delta =
        parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.text ?? '';
      if (delta) {
        yield { type: 'delta', text: hooks.onDelta(String(delta)) };
      }
    }
  }
}
