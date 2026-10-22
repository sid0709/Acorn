import { LLM_CHAT_RETRIES } from '../../../ai/constants/ai-concurrency.constants';
import type { ChatUsage } from '../../../ai/openai/openai.types';
import type {
  AiChatWithUsageService,
  ChatWithUsageInput,
} from '../../../ai-usage/ai-chat-with-usage.service';
import { appLogger } from '../../../common/logger/app-logger';
import { PURPOSE_SET } from '../constants/generator.constants';
import { sectionContentMissing } from './assert-generated-sections';
import { parseJsonLoose } from './parse-json-loose';
import { applyTitlePolicyToSections } from './title-policy';

const log = appLogger('ResumeGenerateStep');

function fail(message: string): never {
  throw Object.assign(new Error(message), { status: 502 });
}

function addChatUsage(
  total: ChatUsage | null,
  step: ChatUsage | null,
): ChatUsage | null {
  if (!step) return total;
  if (!total) return { ...step };
  return {
    promptTokens: total.promptTokens + step.promptTokens,
    completionTokens: total.completionTokens + step.completionTokens,
    totalTokens: total.totalTokens + step.totalTokens,
    cachedTokens: (total.cachedTokens || 0) + (step.cachedTokens || 0),
  };
}

function parseFinalStepOutput(
  content: string,
  purpose: string,
  identity: Record<string, unknown>,
  dynamicTitles: boolean,
): unknown {
  try {
    let output = parseJsonLoose(content);
    if (purpose === 'experience') {
      output = applyTitlePolicyToSections(
        { experience: output as Record<string, unknown> },
        identity,
        dynamicTitles,
      )?.experience;
    }
    return output;
  } catch (err) {
    if (Number.isInteger((err as { status?: number })?.status)) throw err;
    throw Object.assign(
      new Error(`${purpose} final step returned invalid JSON.`),
      { status: 502 },
    );
  }
}

/** Chat + parse a step; retry final Summary/Skills/Experience when parsed content is blank. */
export async function completeGenerationStep(input: {
  chat: AiChatWithUsageService;
  chatInput: ChatWithUsageInput;
  isFinal: boolean;
  purpose: string;
  identity: Record<string, unknown>;
  dynamicTitles: boolean;
  throwIfAborted: () => void;
}): Promise<{ content: string; output: unknown; usage: ChatUsage | null }> {
  const checksEmpty = input.isFinal && PURPOSE_SET.has(input.purpose);
  const maxAttempts = checksEmpty ? LLM_CHAT_RETRIES + 1 : 1;
  let usage: ChatUsage | null = null;
  let messages = input.chatInput.messages;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    input.throwIfAborted();
    const result = await input.chat.chatCompletion({
      ...input.chatInput,
      messages,
    });
    usage = addChatUsage(usage, result.usage);
    let output: unknown = result.content;
    if (input.isFinal) {
      output = parseFinalStepOutput(
        result.content,
        input.purpose,
        input.identity,
        input.dynamicTitles,
      );
      const missing = checksEmpty
        ? sectionContentMissing(input.purpose, output)
        : null;
      if (missing) {
        if (attempt + 1 < maxAttempts) {
          log.warn(
            { purpose: input.purpose, attempt: attempt + 1 },
            'empty section retry',
          );
          messages = [
            ...input.chatInput.messages,
            { role: 'assistant', content: result.content },
            {
              role: 'user',
              content: `${missing} Return JSON again with every profile role in order, each with at least one bullet. Ignore any earlier role-count limit that would drop a profile role.`,
            },
          ];
          continue;
        }
        fail(missing);
      }
    }
    return { content: result.content, output, usage };
  }

  fail(`${input.purpose} was empty.`);
}
