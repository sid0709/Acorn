import { Injectable } from '@nestjs/common';
import { AiChatWithUsageService } from '../../ai-usage/ai-chat-with-usage.service';
import type { ChatMessage } from '../../ai/openai/openai.types';
import { PURPOSE_SET } from './constants/generator.constants';
import { applyPromptTokens } from './lib/apply-prompt-tokens';
import { assertGeneratedSections } from './lib/assert-generated-sections';
import { cleanString } from './lib/clean-string';
import { completeGenerationStep } from './lib/complete-generation-step';
import { finalStepJsonSchema } from './lib/final-step-json-schema';
import type { CheckpointStep } from './lib/generation-checkpoint';
import type { GenerationStepEvent } from './lib/generation-step-event';
import { buildStepUserContent } from './lib/generation-step-prompt';
import {
  buildContextBlock,
  optionalCareerDetailsPrompt,
} from './lib/generation-context';
import { replayCheckpointStep } from './lib/replay-checkpoint-step';
import {
  buildTokenMap,
  formatDraftToken,
  resolveResumePromptSkills,
} from './lib/token-map';
import { applyTitlePolicyToSections, sourceCareers } from './lib/title-policy';
import { addUsage, emptyUsage, usageWithCost } from './lib/usage-aggregate';
import type { PrepareGenerationOk } from './resume-generate-prepare.service';

export type { GenerationStepEvent } from './lib/generation-step-event';

@Injectable()
export class ResumeGeneratePipelineService {
  constructor(private readonly chat: AiChatWithUsageService) {}

  async runGeneration(
    prep: PrepareGenerationOk,
    opts: {
      systemInstruction?: string;
      identity?: Record<string, unknown> | null;
      applierName?: string;
      jobDescription?: string;
      jobSkills?: unknown;
      reasoningEffort?: string;
      signal?: AbortSignal;
      checkpointSteps?: CheckpointStep[];
    },
    onStep?: (event: GenerationStepEvent) => void,
  ) {
    const throwIfAborted = () => {
      if (!opts.signal?.aborted) return;
      throw Object.assign(new Error('Resume generation cancelled'), {
        name: 'AbortError',
      });
    };
    throwIfAborted();

    const identity = opts.identity ?? {};
    const baseTokenMap = {
      ...buildTokenMap(
        identity,
        opts.jobDescription,
        resolveResumePromptSkills(opts.jobSkills, null),
      ),
      source_resume: JSON.stringify(identity, null, 2),
    };

    const dynamicTitles = Boolean(prep.dynamicCareerTitles);
    const careers = sourceCareers(identity);
    const systemContent = [
      applyPromptTokens(
        opts.systemInstruction || 'You are an expert resume writer.',
        baseTokenMap,
      ),
      buildContextBlock(identity),
      optionalCareerDetailsPrompt(identity),
    ]
      .filter(Boolean)
      .join('\n\n');

    const sections: Record<string, unknown> = {};
    const perStep: GenerationStepEvent[] = [];
    let usage = emptyUsage();
    const savedByIndex = new Map(
      (opts.checkpointSteps ?? []).map((step) => [step.index, step]),
    );

    const preparedSteps = prep.steps.map((rawStep, offset) => {
      const step = rawStep || {};
      const index = offset + 1;
      const isFinal = step.kind === 'final';
      const name = cleanString(step.name) || `Step ${index}`;
      return {
        step,
        index,
        isFinal,
        name,
        promptTemplate: cleanString(step.prompt),
      };
    });

    const seriesByPurpose = new Map<string, typeof preparedSteps>();
    for (const prepared of preparedSteps) {
      const purposeKey =
        cleanString(prepared.step.purpose) || `step-${prepared.index}`;
      const series = seriesByPurpose.get(purposeKey) || [];
      series.push(prepared);
      seriesByPurpose.set(purposeKey, series);
    }

    const runPurposeSeries = async (purposeSteps: typeof preparedSteps) => {
      let priorMessages: ChatMessage[] = [];
      let priorDraft: unknown = '';
      for (const prepared of purposeSteps) {
        throwIfAborted();
        const { step, index, isFinal, name, promptTemplate } = prepared;
        const purpose = cleanString(step.purpose) || `step-${index}`;
        const tokenMap: Record<string, string> = {
          ...baseTokenMap,
          [`draft_${purpose}`]: formatDraftToken(priorDraft),
        };
        const userContent = buildStepUserContent({
          promptTemplate,
          tokenMap,
          isFinal,
          purpose: step.purpose,
          schema: step.schema,
          dynamicTitles,
          jobDescription: opts.jobDescription,
          careers,
        });
        const saved = savedByIndex.get(index);
        if (saved) {
          const replayed = replayCheckpointStep({
            saved,
            step,
            index,
            isFinal,
            name,
            userContent,
            priorMessages,
            sections,
            usage,
            total: prep.steps.length,
          });
          priorMessages = replayed.priorMessages;
          priorDraft = replayed.priorDraft;
          usage = replayed.usage;
          perStep.push(replayed.entry);
          onStep?.(replayed.entry);
          continue;
        }
        onStep?.({
          phase: 'step-start',
          index,
          total: prep.steps.length,
          name,
          purpose: step.purpose,
          kind: step.kind,
        });
        const currentUserMessage: ChatMessage = {
          role: 'user',
          content: userContent,
        };
        const messages: ChatMessage[] = [
          { role: 'system', content: systemContent },
          ...priorMessages,
          currentUserMessage,
        ];
        const featurePurpose =
          cleanString(step.purpose) || cleanString(step.kind) || 'step';
        const jsonSchema = isFinal ? finalStepJsonSchema(step) : undefined;
        const {
          content,
          output,
          usage: stepUsageRaw,
        } = await completeGenerationStep({
          chat: this.chat,
          chatInput: {
            provider: prep.providerId as 'openai' | 'deepseek',
            apiKey: prep.apiKey,
            model: prep.model,
            messages,
            jsonMode: Boolean(isFinal) && !jsonSchema,
            jsonSchema,
            reasoningEffort: opts.reasoningEffort,
            signal: opts.signal,
            usageMeta: {
              feature: `resume-generate:${featurePurpose}`,
              applierName: opts.applierName || prep.applierName,
              path: '/personal/resume-generate',
            },
          },
          isFinal,
          purpose: cleanString(step.purpose),
          identity,
          dynamicTitles,
          throwIfAborted,
        });
        throwIfAborted();
        priorMessages = [
          ...priorMessages,
          currentUserMessage,
          { role: 'assistant', content: String(content ?? '') },
        ];
        if (isFinal && PURPOSE_SET.has(String(step.purpose))) {
          sections[String(step.purpose)] = output;
        }

        priorDraft = output;

        const stepUsage = usageWithCost(stepUsageRaw, prep.model);
        usage = addUsage(usage, stepUsage);
        const entry: GenerationStepEvent = {
          phase: 'step-done',
          index,
          total: prep.steps.length,
          name,
          purpose: step.purpose,
          kind: step.kind,
          usage: stepUsage,
          output,
          content: String(content ?? ''),
          cumulative: usage,
        };
        perStep.push(entry);
        onStep?.(entry);
      }
    };

    const seriesResults = await Promise.allSettled(
      [...seriesByPurpose.values()].map((s) => runPurposeSeries(s)),
    );
    const failed = seriesResults.find((r) => r.status === 'rejected');
    if (failed && failed.status === 'rejected') throw failed.reason;
    perStep.sort((a, b) => Number(a.index) - Number(b.index));

    Object.assign(
      sections,
      applyTitlePolicyToSections(sections, identity, dynamicTitles) || {},
    );
    throwIfAborted();

    const requiredPurposes = [
      ...new Set(
        preparedSteps
          .filter((prepared) => prepared.isFinal)
          .map((prepared) => cleanString(prepared.step.purpose))
          .filter((purpose) => PURPOSE_SET.has(purpose)),
      ),
    ];
    assertGeneratedSections(sections, {
      required: requiredPurposes,
      identity,
    });

    return {
      sections,
      perStep,
      usage,
      coverageContract: null,
      isBeta: Boolean(prep.isBeta),
      dynamicCareerTitles: dynamicTitles,
    };
  }
}
