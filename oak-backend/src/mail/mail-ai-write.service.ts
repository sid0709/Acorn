import { Injectable } from '@nestjs/common';
import { ProfileLlmAuthService } from '../ai/auth/profile-llm-auth.service';
import { AiChatWithUsageService } from '../ai-usage/ai-chat-with-usage.service';
import { AI_USAGE_FEATURES } from '../ai-usage/constants/ai-usage.constants';

@Injectable()
export class MailAiWriteService {
  constructor(
    private readonly llmAuth: ProfileLlmAuthService,
    private readonly chat: AiChatWithUsageService,
  ) {}

  async write(input: {
    applierName: string;
    mode: 'write' | 'fine-tune' | 'reply';
    prompt?: string;
    body?: string;
    subject?: string;
    replyContext?: string;
  }) {
    const auth = await this.llmAuth.resolve({ applierName: input.applierName });
    const system =
      input.mode === 'reply'
        ? 'You write concise professional email replies. Return only the email body text.'
        : input.mode === 'fine-tune'
          ? 'You refine the given email draft. Return only the improved email body.'
          : 'You write professional emails from the user prompt. Return only the email body.';

    const userParts = [
      input.subject ? `Subject: ${input.subject}` : '',
      input.replyContext ? `Reply context:\n${input.replyContext}` : '',
      input.body ? `Current draft:\n${input.body}` : '',
      input.prompt ? `Instructions:\n${input.prompt}` : '',
    ].filter(Boolean);

    const result = await this.chat.chatCompletion({
      provider: auth.provider,
      apiKey: auth.apiKey,
      model: auth.model,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: userParts.join('\n\n') || 'Write a short email.',
        },
      ],
      temperature: 0.4,
      usageMeta: {
        feature: AI_USAGE_FEATURES.mailWrite,
        applierName: auth.applierName,
        path: '/mail/ai-write',
      },
    });

    return {
      body: String(result.content || '').trim(),
      usage: result.usage,
    };
  }
}
