import { Injectable } from '@nestjs/common';
import {
  OPENAI_RESPONSES_URL,
  oakMaxOutputTokens,
  oakModelRejectsTemperature,
  oakReasoningEffortForModel,
  oakTemperature,
} from '../constants/oak.constants';
import { summarizeUsage, type OakUsageSummary } from './oak-pricing';
import { ACTION_PLAN_FORMAT, validatePlanShape } from './oak-schema';

export type OakLlmAuth = {
  apiKey: string;
  model: string;
};

@Injectable()
export class OakResponsesService {
  async requestActionPlan(
    auth: OakLlmAuth,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<{
    plan: Record<string, unknown>;
    model: string;
    responseId: string | null;
    usage: OakUsageSummary;
  }> {
    const body: Record<string, unknown> = {
      model: auth.model,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: systemPrompt }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: userPrompt }],
        },
      ],
      max_output_tokens: oakMaxOutputTokens(),
      text: { format: ACTION_PLAN_FORMAT },
    };

    applySamplingParams(body, auth.model);

    const data = await this.postResponses(auth.apiKey, body);
    const text = extractOutputText(data);
    if (!text?.trim()) throw new Error('OpenAI returned empty output');

    let plan: unknown;
    try {
      plan = JSON.parse(text);
    } catch {
      throw new Error('OpenAI returned non-JSON output');
    }
    validatePlanShape(plan);

    const model =
      typeof data.model === 'string' && data.model ? data.model : auth.model;
    return {
      plan: plan,
      model,
      responseId: typeof data.id === 'string' ? data.id : null,
      usage: summarizeUsage(data.usage, model),
    };
  }

  async requestJsonSchema(
    auth: OakLlmAuth,
    input: {
      systemPrompt: string;
      userPrompt: string;
      format: Record<string, unknown>;
      maxOutputTokens?: number;
      clampReasoningToLow?: boolean;
      temperature?: number;
      signal?: AbortSignal;
    },
  ): Promise<{ text: string; model: string; usage: OakUsageSummary }> {
    const body: Record<string, unknown> = {
      model: auth.model,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: input.systemPrompt }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: input.userPrompt }],
        },
      ],
      max_output_tokens: input.maxOutputTokens ?? 400,
      text: { format: input.format },
    };

    applySamplingParams(body, auth.model, {
      clampReasoningToLow: input.clampReasoningToLow,
      temperature: input.temperature,
    });

    const data = await this.postResponses(auth.apiKey, body, input.signal);
    const text = extractOutputText(data);
    if (!text?.trim()) {
      throw new Error('OpenAI returned empty output');
    }
    const model =
      typeof data.model === 'string' && data.model ? data.model : auth.model;
    return {
      text,
      model,
      usage: summarizeUsage(data.usage, model),
    };
  }

  private async postResponses(
    apiKey: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      const err = data.error as { message?: string } | undefined;
      throw new Error(
        typeof err?.message === 'string'
          ? err.message
          : `OpenAI request failed: ${res.status}`,
      );
    }
    return data;
  }
}

function applySamplingParams(
  body: Record<string, unknown>,
  model: string,
  opts?: { clampReasoningToLow?: boolean; temperature?: number },
): void {
  const effort = oakReasoningEffortForModel(model);
  if (effort) {
    let next = effort === 'xhigh' ? 'high' : effort;
    if (
      opts?.clampReasoningToLow &&
      ['high', 'xhigh', 'medium'].includes(effort)
    ) {
      next = 'low';
    }
    body.reasoning = { effort: next };
    return;
  }
  if (!oakModelRejectsTemperature(model)) {
    body.temperature =
      typeof opts?.temperature === 'number'
        ? opts.temperature
        : oakTemperature();
  }
}

function extractOutputText(data: Record<string, unknown>): string {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }
  const chunks: string[] = [];
  for (const item of (data.output as Array<Record<string, unknown>>) ?? []) {
    if (item?.type === 'refusal') {
      throw new Error(
        typeof item.refusal === 'string'
          ? item.refusal
          : 'OpenAI refused the request',
      );
    }
    if (item?.type !== 'message') continue;
    for (const part of (item.content as Array<Record<string, unknown>>) ?? []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join('\n');
}
