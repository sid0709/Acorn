import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ProfileLlmAuthService } from '../ai/auth/profile-llm-auth.service';
import { OpenAiChatStreamService } from '../ai/openai/openai-chat-stream.service';
import type { ChatMessage, ChatUsage } from '../ai/openai/openai.types';
import { AiChatWithUsageService } from '../ai-usage/ai-chat-with-usage.service';
import { AiUsageRecorderService } from '../ai-usage/ai-usage-recorder.service';
import { AI_USAGE_FEATURES } from '../ai-usage/constants/ai-usage.constants';
import { BidLifecycleService } from '../bids/bid-lifecycle.service';
import { ProfileSecretsService } from '../personal/secrets/profile-secrets.service';
import { PrismaService } from '../prisma/prisma.service';
import { ASK_AI_SYSTEM_PROMPT } from './ask-ai.prompt';
import {
  buildFormAnswerUserPrompt,
  compactProfileJson,
  mapAskAiUsage,
  normalizePageContext,
  sanitizeProfile,
} from './lib/ask-ai-context';
import {
  extractFormAnswersFromPartialText,
  type FormAnswer,
} from './lib/extract-form-answers';

export type AskAiInput = {
  applierName: string;
  pageContext: Record<string, unknown>;
  jobId?: string;
  jobTitle?: string;
  signal?: AbortSignal;
};

export type AskAiStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'answers'; answers: FormAnswer[] }
  | {
      type: 'done';
      summary: string;
      answers: FormAnswer[];
      mode: 'llm-stream';
      usage: Record<string, unknown> | null;
      requestId: string;
      durationMs: number;
      ttftMs: number | null;
      model: string;
      pageUrl: string;
      pageTitle: string;
    };

@Injectable()
export class LensAskAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmAuth: ProfileLlmAuthService,
    private readonly chat: AiChatWithUsageService,
    private readonly chatStream: OpenAiChatStreamService,
    private readonly usageRecorder: AiUsageRecorderService,
    private readonly secrets: ProfileSecretsService,
    private readonly lifecycle: BidLifecycleService,
  ) {}

  async answer(input: AskAiInput) {
    const ctx = normalizePageContext(input.pageContext);
    const { auth, messages } = await this.prepare(input, ctx);
    const requestId = randomUUID();
    const completion = await this.chat.chatCompletion({
      provider: auth.provider,
      apiKey: auth.apiKey,
      model: auth.model,
      messages,
      signal: input.signal,
      usageMeta: {
        feature: AI_USAGE_FEATURES.lensAskAi,
        applierName: input.applierName,
        jobId: input.jobId,
        requestId,
        path: '/athens-lens/ask-ai',
      },
    });

    const answers = extractFormAnswersFromPartialText(
      completion.content,
      ctx.formTree,
    );
    const summary = answers.length ? `Answered ${answers.length} fields.` : '';
    const usage = mapAskAiUsage(completion.usage, auth.model);

    if (input.jobId) {
      await this.lifecycle.persistAnalysis({
        applierName: input.applierName,
        jobId: input.jobId,
        summary,
        answers,
        pageUrl: ctx.url,
        pageTitle: ctx.title,
        mode: 'llm',
        usage: usage ?? undefined,
        requestId,
      });
    }

    return {
      success: true as const,
      mode: 'llm' as const,
      summary,
      answers,
      pageUrl: ctx.url,
      pageTitle: ctx.title,
      usage,
      requestId,
    };
  }

  async *streamAnswer(input: AskAiInput): AsyncGenerator<AskAiStreamEvent> {
    const ctx = normalizePageContext(input.pageContext);
    const { auth, messages } = await this.prepare(input, ctx);
    const requestId = randomUUID();
    let fullText = '';
    let lastFingerprint = '';
    let finalAnswers: FormAnswer[] = [];
    let durationMs = 0;
    let ttftMs: number | null = null;
    let model = auth.model;
    let usage: Record<string, unknown> | null = null;

    for await (const event of this.chatStream.chatCompletionStream({
      provider: auth.provider,
      apiKey: auth.apiKey,
      model: auth.model,
      messages,
      signal: input.signal,
    })) {
      if (event.type === 'delta') {
        fullText += event.text;
        yield { type: 'delta', text: event.text };
        const answers = extractFormAnswersFromPartialText(
          fullText,
          ctx.formTree,
        );
        const fingerprint = answers
          .map((a) => `${a.question}\0${a.suggestedAnswer}`)
          .join('\n');
        if (fingerprint && fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint;
          finalAnswers = answers;
          yield { type: 'answers', answers };
        }
        continue;
      }
      finalAnswers = extractFormAnswersFromPartialText(fullText, ctx.formTree);
      durationMs = event.durationMs;
      ttftMs = event.ttftMs;
      model = event.model || auth.model;
      usage = mapAskAiUsage(event.usage, model);
      await this.usageRecorder.record({
        feature: AI_USAGE_FEATURES.lensAskAi,
        applierName: input.applierName,
        jobId: input.jobId,
        requestId,
        path: '/athens-lens/ask-ai/stream',
        provider: auth.provider,
        requestedModel: auth.model,
        billedModel: model,
        apiKey: auth.apiKey,
        usage: event.usage,
        durationMs,
        success: true,
      });
    }

    const summary = finalAnswers.length
      ? `Answered ${finalAnswers.length} fields.`
      : '';

    if (input.jobId) {
      await this.lifecycle.persistAnalysis({
        applierName: input.applierName,
        jobId: input.jobId,
        summary,
        answers: finalAnswers,
        pageUrl: ctx.url,
        pageTitle: ctx.title,
        mode: 'llm-stream',
        usage: usage ?? undefined,
        requestId,
      });
    }

    yield {
      type: 'done',
      summary,
      answers: finalAnswers,
      mode: 'llm-stream',
      usage,
      requestId,
      durationMs,
      ttftMs,
      model,
      pageUrl: ctx.url,
      pageTitle: ctx.title,
    };
  }

  private async prepare(
    input: AskAiInput,
    ctx: ReturnType<typeof normalizePageContext>,
  ) {
    if (!ctx.visibleText && !ctx.formTree) {
      throw new BadRequestException({
        success: false,
        message: 'pageContext.visibleText or formTree is required',
      });
    }

    const account = await this.prisma.accountInfo.findUnique({
      where: { name: input.applierName },
      select: { autoBidProfile: true },
    });
    const profileRaw =
      account?.autoBidProfile && typeof account.autoBidProfile === 'object'
        ? (account.autoBidProfile as Record<string, unknown>)
        : {};
    const decrypted = this.secrets.decryptSelected(profileRaw, []);
    const profileJson = compactProfileJson(sanitizeProfile(decrypted));
    if (profileJson === '{}') {
      throw new BadRequestException({
        success: false,
        message:
          'No profile data found for this applier. Save Profile settings first.',
      });
    }

    const auth = await this.llmAuth.resolve({ applierName: input.applierName });
    const messages: ChatMessage[] = [
      { role: 'system', content: ASK_AI_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildFormAnswerUserPrompt(ctx, profileJson, input.jobTitle),
      },
    ];
    return { auth, messages };
  }
}
