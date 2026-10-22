import type { Prisma } from '@prisma/client';
import { recordCheckpointProgress } from './generation-checkpoint';
import type { GenerationStepEvent } from './generation-step-event';

export type StoredGenerationProgress = Record<string, unknown>;

/** Merge a step event into stored progress, keeping completed outputs. */
export function progressFromStep(
  step: GenerationStepEvent,
  previous: unknown,
): StoredGenerationProgress {
  return recordCheckpointProgress(previous, step);
}

export function asJsonObject(value: unknown): Prisma.InputJsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Prisma.InputJsonObject) };
  }
  return {};
}
