import { Injectable, Logger } from '@nestjs/common';
import type { ProfileLlmAuth } from '../ai/auth/profile-llm-auth.service';
import { openaiModelRejectsTemperature } from '../ai/openai/openai-provider';
import { AiChatWithUsageService } from '../ai-usage/ai-chat-with-usage.service';
import { AI_USAGE_FEATURES } from '../ai-usage/constants/ai-usage.constants';
import { MAIL_AI_LABEL_CLASSIFY_ATTEMPTS } from './constants/mail.constants';
import {
  compactLlmError,
  logMailAiLabel,
  mapOrdinalLabels,
  mergeUsage,
  parseClassifyResults,
  toOrdinalItems,
} from './mail-ai-label.parse';
import {
  MAIL_AI_LABEL_JSON_SCHEMA,
  MAIL_AI_LABEL_SCHEMA_NAME,
} from './mail-ai-label.schema';

const CLASSIFY_SYSTEM = [
  'You classify each email into exactly ONE custom Gmail label from the provided list.',
  'Use sender, subject, and the truncated plain-text body.',
  'Return one result for EVERY email id you were given, using the exact id.',
  'If no label is a reasonable fit, return null for that email label.',
  'Return ONLY JSON: { "results": [{ "id": string, "label": string|null }] }.',
].join('\n');

export type MailAiLabelCatalogItem = { name: string; description: string };

export type MailAiLabelClassifyItem = { id: string; text: string };

export type MailAiLabelClassifyBatch = {
  labels: Record<string, string | null>;
  /** Ids the model never answered — retryable, not a genuine no-match. */
  missingIds?: string[];
  usage?: Record<string, unknown>;
  error?: string;
  requests: number;
};

type ClassifyInput = {
  auth: ProfileLlmAuth;
  catalog: MailAiLabelCatalogItem[];
  emails: MailAiLabelClassifyItem[];
  signal?: AbortSignal;
};

@Injectable()
export class MailAiLabelClassifyService {
  private readonly logger = new Logger(MailAiLabelClassifyService.name);

  constructor(private readonly chat: AiChatWithUsageService) {}

  async classifyBatch(input: ClassifyInput): Promise<MailAiLabelClassifyBatch> {
    if (!input.emails.length) return { labels: {}, requests: 0 };
    return this.classifyGroup(input, MAIL_AI_LABEL_CLASSIFY_ATTEMPTS);
  }

  /**
   * Try the group up to `attempts` times. If it still fails, halve it and retry
   * each side once, so a single bad email cannot fail its whole batch.
   */
  private async classifyGroup(
    input: ClassifyInput,
    attempts: number,
  ): Promise<MailAiLabelClassifyBatch> {
    let usage: Record<string, unknown> | undefined;
    let requests = 0;
    let error = '';

    for (let attempt = 0; attempt < attempts; attempt++) {
      const result = await this.classifyOnce(input);
      usage = mergeUsage(usage, result.usage);
      requests += 1;
      if (!result.error) {
        return {
          labels: result.labels,
          missingIds: result.missingIds,
          usage,
          requests,
        };
      }
      error = result.error;
    }

    if (input.emails.length <= 1) {
      return { labels: emptyLabels(idsOf(input)), usage, error, requests };
    }
    return this.classifySplit(input, { usage, requests, error });
  }

  private async classifySplit(
    input: ClassifyInput,
    carry: {
      usage?: Record<string, unknown>;
      requests: number;
      error: string;
    },
  ): Promise<MailAiLabelClassifyBatch> {
    const mid = Math.ceil(input.emails.length / 2);
    const halves = [input.emails.slice(0, mid), input.emails.slice(mid)];
    logMailAiLabel(this.logger, 'ai_classify_split', {
      emails: input.emails.length,
      error: carry.error,
    });

    const labels: Record<string, string | null> = {};
    const missingIds: string[] = [];
    const errors: string[] = [];
    let usage = carry.usage;
    let requests = carry.requests;

    for (const emails of halves) {
      if (!emails.length) continue;
      const part = await this.classifyGroup({ ...input, emails }, 1);
      Object.assign(labels, part.labels);
      if (part.missingIds?.length) missingIds.push(...part.missingIds);
      if (part.error) errors.push(part.error);
      usage = mergeUsage(usage, part.usage);
      requests += part.requests;
    }

    return {
      labels,
      missingIds,
      usage,
      error: errors.length ? errors[0] : undefined,
      requests,
    };
  }

  private async classifyOnce(input: ClassifyInput): Promise<{
    labels: Record<string, string | null>;
    missingIds: string[];
    usage?: Record<string, unknown>;
    error?: string;
  }> {
    const ids = idsOf(input);
    const { ordinals, realById } = toOrdinalItems(input.emails);
    const started = Date.now();
    logMailAiLabel(this.logger, 'ai_classify_start', {
      provider: input.auth.provider,
      model: input.auth.model,
      emails: ids.length,
      labels: input.catalog.length,
      omitTemperature: openaiModelRejectsTemperature(input.auth.model),
    });
    try {
      const result = await this.chat.chatCompletion({
        provider: input.auth.provider,
        apiKey: input.auth.apiKey,
        model: input.auth.model,
        jsonMode: true,
        jsonSchema: {
          name: MAIL_AI_LABEL_SCHEMA_NAME,
          schema: MAIL_AI_LABEL_JSON_SCHEMA as unknown as Record<
            string,
            unknown
          >,
          strict: true,
        },
        signal: input.signal,
        messages: [
          { role: 'system', content: CLASSIFY_SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({
              allowedLabels: input.catalog,
              emails: ordinals,
            }),
          },
        ],
        usageMeta: {
          feature: AI_USAGE_FEATURES.mailLabel,
          applierName: input.auth.applierName,
          path: '/mail/ai-label',
        },
      });
      const usage = result.usage as Record<string, unknown> | undefined;
      const parsed = parseClassifyResults(
        String(result.content || ''),
        ordinals.map((ordinal) => ordinal.id),
      );
      if (!parsed) {
        logMailAiLabel(this.logger, 'ai_classify_error', {
          kind: 'parse_json',
          ms: Date.now() - started,
          emails: ids.length,
        });
        return {
          labels: emptyLabels(ids),
          missingIds: ids,
          usage,
          error: 'Failed to parse classification JSON',
        };
      }
      const mapped = mapOrdinalLabels(parsed, realById);
      const matched = Object.values(mapped.labels).filter(Boolean).length;
      logMailAiLabel(this.logger, 'ai_classify_ok', {
        ms: Date.now() - started,
        emails: ids.length,
        matched,
        unmatched: ids.length - matched - mapped.missingIds.length,
        dropped: mapped.missingIds.length,
      });
      return { labels: mapped.labels, missingIds: mapped.missingIds, usage };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logMailAiLabel(this.logger, 'ai_classify_error', {
        kind: 'llm_http',
        ms: Date.now() - started,
        emails: ids.length,
        error: compactLlmError(message),
      });
      if (input.signal?.aborted) throw err;
      return { labels: emptyLabels(ids), missingIds: ids, error: message };
    }
  }
}

function idsOf(input: ClassifyInput): string[] {
  return input.emails.map((email) => email.id);
}

function emptyLabels(ids: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const id of ids) out[id] = null;
  return out;
}
