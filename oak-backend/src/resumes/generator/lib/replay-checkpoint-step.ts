import type { ChatMessage } from '../../../ai/openai/openai.types';
import { PURPOSE_SET } from '../constants/generator.constants';
import type { CheckpointStep } from './generation-checkpoint';
import type { GenerationStepEvent } from './generation-step-event';
import { addUsage, emptyUsage, type GenerationUsage } from './usage-aggregate';

/** Restore prior conversation + section output for a completed step (no LLM). */
export function replayCheckpointStep(input: {
  saved: CheckpointStep;
  step: Record<string, unknown>;
  index: number;
  isFinal: boolean;
  name: string;
  userContent: string;
  priorMessages: ChatMessage[];
  sections: Record<string, unknown>;
  usage: GenerationUsage;
  total: number;
}): {
  priorMessages: ChatMessage[];
  priorDraft: unknown;
  usage: GenerationUsage;
  entry: GenerationStepEvent;
} {
  const priorMessages: ChatMessage[] = [
    ...input.priorMessages,
    { role: 'user', content: input.userContent },
    { role: 'assistant', content: input.saved.assistantContent },
  ];
  if (input.isFinal && PURPOSE_SET.has(String(input.step.purpose))) {
    input.sections[String(input.step.purpose)] = input.saved.output;
  }
  const stepUsage = input.saved.usage || emptyUsage();
  const usage = addUsage(input.usage, stepUsage);
  return {
    priorMessages,
    priorDraft: input.saved.output,
    usage,
    entry: {
      phase: 'step-done',
      index: input.index,
      total: input.total,
      name: input.name,
      purpose: input.step.purpose,
      kind: input.step.kind,
      usage: stepUsage,
      output: input.saved.output,
      content: input.saved.assistantContent,
      cumulative: usage,
    },
  };
}
