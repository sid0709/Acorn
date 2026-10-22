import { Injectable } from '@nestjs/common';
import { appLogger } from '../../common/logger/app-logger';
import {
  LLM_CHAT_RETRIES,
  LLM_CHAT_TIMEOUT_MS,
} from '../constants/ai-concurrency.constants';
import { compactError, llmMessageStats } from './llm-log-fields';
import {
  abortError,
  buildChatCompletionBody,
  extractChatMessageContent,
  isRetryableStatus,
  PROVIDER_BASE,
  timeoutError,
} from './openai-provider';
import { parseChatUsage } from './parse-chat-usage';
import type { ChatCompletionInput, ChatCompletionResult } from './openai.types';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Thin OpenAI-compatible chat client (OpenAI + OpenRouter).
 * Callers supply messages; no domain prompts live here.
 */
@Injectable()
export class OpenAiChatService {
  private readonly log = appLogger(OpenAiChatService.name);

  async chatCompletion(
    input: ChatCompletionInput,
  ): Promise<ChatCompletionResult> {
    const provider = input.provider ?? 'openai';
    const base = PROVIDER_BASE[provider] ?? PROVIDER_BASE.openai;
    const timeoutMs = input.timeoutMs ?? LLM_CHAT_TIMEOUT_MS;
    const retries = input.retries ?? LLM_CHAT_RETRIES;
    const body = buildChatCompletionBody(provider, input);
    const stats = llmMessageStats(input.messages);
    const startedAt = Date.now();

    this.log.debug(
      {
        provider,
        model: input.model,
        jsonMode: Boolean(input.jsonMode),
        hasJsonSchema: Boolean(input.jsonSchema),
        timeoutMs,
        retries,
        ...stats,
      },
      'LLM chat start',
    );

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (input.signal?.aborted) throw abortError(input.signal);
      const attemptStarted = Date.now();
      try {
        const result = await this.once(
          base,
          input.apiKey,
          body,
          timeoutMs,
          input.signal,
        );
        this.log.info(
          {
            provider,
            model: input.model,
            billedModel: result.model,
            attempt,
            durationMs: Date.now() - startedAt,
            attemptMs: Date.now() - attemptStarted,
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
            totalTokens: result.usage?.totalTokens,
            cachedTokens: result.usage?.cachedTokens,
            contentChars: String(result.content || '').length,
            ...stats,
          },
          'LLM chat ok',
        );
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (input.signal?.aborted || lastError.name === 'AbortError') {
          this.log.warn(
            {
              provider,
              model: input.model,
              attempt,
              durationMs: Date.now() - startedAt,
              errName: lastError.name,
              err: compactError(lastError),
              ...stats,
            },
            'LLM chat aborted',
          );
          throw input.signal?.aborted ? abortError(input.signal) : lastError;
        }
        const retryable =
          (lastError as Error & { retryable?: boolean }).retryable !== false;
        const status = (lastError as Error & { status?: number }).status;
        if (!retryable || attempt >= retries) {
          this.log.error(
            {
              provider,
              model: input.model,
              attempt,
              durationMs: Date.now() - startedAt,
              retryable,
              httpStatus: status,
              errName: lastError.name,
              err: compactError(lastError),
              ...stats,
            },
            'LLM chat failed',
          );
          throw lastError;
        }
        const backoff = Math.min(8_000, 400 * 2 ** attempt);
        this.log.warn(
          {
            provider,
            model: input.model,
            attempt,
            nextAttempt: attempt + 1,
            backoffMs: backoff,
            retryable,
            httpStatus: status,
            errName: lastError.name,
            err: compactError(lastError),
          },
          'LLM chat retry',
        );
        await sleep(backoff, input.signal);
      }
    }
    throw lastError ?? new Error('LLM chat failed');
  }

  private async once(
    base: string,
    apiKey: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    outerSignal?: AbortSignal,
  ): Promise<ChatCompletionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    outerSignal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        const err = new Error(
          `LLM HTTP ${res.status}: ${text.slice(0, 400)}`,
        ) as Error & { retryable?: boolean; status?: number };
        err.status = res.status;
        err.retryable = isRetryableStatus(res.status);
        throw err;
      }

      let data: {
        choices?: Array<{
          message?: {
            content?: string | null;
            reasoning_content?: string | null;
          };
        }>;
        model?: string;
        usage?: Record<string, unknown>;
      };
      try {
        data = JSON.parse(text) as typeof data;
      } catch {
        throw Object.assign(new Error('LLM returned non-JSON body'), {
          retryable: false,
        });
      }

      const content = extractChatMessageContent(data.choices?.[0]?.message);
      if (!content.trim()) {
        throw Object.assign(new Error('LLM returned empty content'), {
          retryable: true,
        });
      }

      const usage = parseChatUsage(data.usage);

      return {
        content,
        model: String(
          typeof data.model === 'string'
            ? data.model
            : typeof body.model === 'string'
              ? body.model
              : '',
        ),
        usage,
      };
    } catch (err) {
      if (outerSignal?.aborted) throw abortError(outerSignal);
      if (controller.signal.aborted) throw timeoutError(timeoutMs);
      throw err;
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', onOuterAbort);
    }
  }
}
