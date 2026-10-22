import { PURPOSE_SET } from '../constants/generator.constants';
import { sectionContentMissing } from './assert-generated-sections';
import { cleanString } from './clean-string';
import { formatDraftToken } from './token-map';
import type { GenerationUsage } from './usage-aggregate';

/** One completed pipeline step saved for Continue. */
export type CheckpointStep = {
  index: number;
  name: string;
  purpose: string;
  kind: unknown;
  output: unknown;
  assistantContent: string;
  usage?: GenerationUsage;
};

export type CheckpointStepEvent = {
  phase: string;
  index?: number;
  total?: number;
  name?: string;
  purpose?: unknown;
  kind?: unknown;
  usage?: GenerationUsage;
  output?: unknown;
  content?: string;
};

export type GenerationCheckpoint = {
  total: number;
  completedIndexes: number[];
  failedStepIndex: number | null;
  failedStepName: string | null;
  failedStepPurpose: string | null;
  error: string | null;
  steps: CheckpointStep[];
  sections: Record<string, unknown>;
};

export function parseCheckpoint(
  progress: unknown,
  partialSections?: unknown,
): GenerationCheckpoint {
  const prior =
    progress && typeof progress === 'object' && !Array.isArray(progress)
      ? (progress as Record<string, unknown>)
      : {};
  const steps = Array.isArray(prior.checkpointSteps)
    ? prior.checkpointSteps
        .map(parseCheckpointStep)
        .filter((step): step is CheckpointStep => Boolean(step))
    : [];
  const completedIndexes = uniqueIndexes([
    ...steps.map((step) => step.index),
    ...(Array.isArray(prior.completedIndexes)
      ? prior.completedIndexes.map((value) => Number(value))
      : []),
  ]);
  return {
    total: Number(prior.total) || 0,
    completedIndexes,
    failedStepIndex: nullableIndex(prior.failedStepIndex),
    failedStepName: cleanString(prior.failedStepName) || null,
    failedStepPurpose: cleanString(prior.failedStepPurpose) || null,
    error: cleanString(prior.error) || null,
    steps,
    sections: {
      ...asObject(prior.sections),
      ...asObject(partialSections),
    },
  };
}

export function nextIncompleteIndex(
  checkpoint: GenerationCheckpoint,
): number | null {
  const completed = new Set(checkpoint.completedIndexes);
  if (
    checkpoint.failedStepIndex &&
    !completed.has(checkpoint.failedStepIndex)
  ) {
    return checkpoint.failedStepIndex;
  }
  const total =
    checkpoint.total || Math.max(0, ...checkpoint.completedIndexes, 0);
  for (let index = 1; index <= total; index += 1) {
    if (!completed.has(index)) return index;
  }
  return checkpoint.failedStepIndex &&
    !completed.has(checkpoint.failedStepIndex)
    ? checkpoint.failedStepIndex
    : null;
}

/** Merge a live step event into stored progress (preserves earlier outputs). */
export function recordCheckpointProgress(
  previous: unknown,
  step: CheckpointStepEvent,
  partialSections?: unknown,
): Record<string, unknown> {
  const checkpoint = parseCheckpoint(previous, partialSections);
  if (step.phase === 'step-done') {
    const snapshot = checkpointStepFromEvent(step);
    if (snapshot) {
      checkpoint.steps = [
        ...checkpoint.steps.filter((entry) => entry.index !== snapshot.index),
        snapshot,
      ].sort((a, b) => a.index - b.index);
      checkpoint.completedIndexes = checkpoint.steps.map(
        (entry) => entry.index,
      );
      maybeStoreSection(checkpoint, step);
      if (checkpoint.failedStepIndex === snapshot.index) {
        checkpoint.failedStepIndex = null;
        checkpoint.failedStepName = null;
        checkpoint.failedStepPurpose = null;
        checkpoint.error = null;
      }
    }
  }
  checkpoint.total = Number(step.total) || checkpoint.total;
  return serializeCheckpoint(checkpoint, step);
}

export function markCheckpointFailure(
  previous: unknown,
  step: CheckpointStepEvent | null,
  error: string,
  partialSections?: unknown,
): Record<string, unknown> {
  const checkpoint = parseCheckpoint(previous, partialSections);
  const index = Number(step?.index) || checkpoint.failedStepIndex;
  checkpoint.failedStepIndex = index && index > 0 ? index : null;
  checkpoint.failedStepName =
    cleanString(step?.name) || checkpoint.failedStepName;
  checkpoint.failedStepPurpose =
    cleanString(step?.purpose) || checkpoint.failedStepPurpose;
  checkpoint.error = error || checkpoint.error;
  return serializeCheckpoint(checkpoint, {
    phase: 'step-failed',
    index: checkpoint.failedStepIndex ?? undefined,
    total: checkpoint.total,
    name: checkpoint.failedStepName ?? undefined,
    purpose: checkpoint.failedStepPurpose ?? undefined,
  });
}

export function checkpointPublicView(checkpoint: GenerationCheckpoint) {
  return {
    completedIndexes: checkpoint.completedIndexes,
    completedSteps: checkpoint.steps.map((step) => ({
      index: step.index,
      name: step.name,
      purpose: step.purpose,
      kind: step.kind,
    })),
    failedStep: checkpoint.failedStepIndex
      ? {
          index: checkpoint.failedStepIndex,
          name: checkpoint.failedStepName,
          purpose: checkpoint.failedStepPurpose,
        }
      : null,
    nextStepIndex: nextIncompleteIndex(checkpoint),
  };
}

function maybeStoreSection(
  checkpoint: GenerationCheckpoint,
  step: CheckpointStepEvent,
) {
  const purpose = cleanString(step.purpose);
  if (
    step.kind !== 'final' ||
    !PURPOSE_SET.has(purpose) ||
    step.output == null ||
    sectionContentMissing(purpose, step.output)
  ) {
    return;
  }
  checkpoint.sections = {
    ...checkpoint.sections,
    [purpose]: step.output,
  };
}

function serializeCheckpoint(
  checkpoint: GenerationCheckpoint,
  step: CheckpointStepEvent | null,
): Record<string, unknown> {
  return {
    index: Number(step?.index) || checkpoint.failedStepIndex || 0,
    total: checkpoint.total,
    name: cleanString(step?.name) || checkpoint.failedStepName || '',
    purpose: cleanString(step?.purpose) || checkpoint.failedStepPurpose || '',
    phase: cleanString(step?.phase),
    completedSteps: checkpoint.completedIndexes.length,
    completedIndexes: checkpoint.completedIndexes,
    failedStepIndex: checkpoint.failedStepIndex,
    failedStepName: checkpoint.failedStepName,
    failedStepPurpose: checkpoint.failedStepPurpose,
    error: checkpoint.error,
    checkpointSteps: checkpoint.steps,
    sections: checkpoint.sections,
  };
}

function checkpointStepFromEvent(
  step: CheckpointStepEvent,
): CheckpointStep | null {
  const index = Number(step.index);
  if (!Number.isInteger(index) || index < 1) return null;
  return {
    index,
    name: cleanString(step.name) || `Step ${index}`,
    purpose: cleanString(step.purpose),
    kind: step.kind,
    output: step.output,
    assistantContent:
      cleanString(step.content) || formatDraftToken(step.output),
    usage: step.usage,
  };
}

function parseCheckpointStep(raw: unknown): CheckpointStep | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const index = Number(row.index);
  if (!Number.isInteger(index) || index < 1) return null;
  return {
    index,
    name: cleanString(row.name) || `Step ${index}`,
    purpose: cleanString(row.purpose),
    kind: row.kind,
    output: row.output,
    assistantContent:
      cleanString(row.assistantContent) || formatDraftToken(row.output),
    usage:
      row.usage && typeof row.usage === 'object' && !Array.isArray(row.usage)
        ? (row.usage as GenerationUsage)
        : undefined,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function uniqueIndexes(values: number[]): number[] {
  return [
    ...new Set(values.filter((value) => Number.isInteger(value) && value > 0)),
  ].sort((a, b) => a - b);
}

function nullableIndex(value: unknown): number | null {
  const index = Number(value);
  return Number.isInteger(index) && index > 0 ? index : null;
}
