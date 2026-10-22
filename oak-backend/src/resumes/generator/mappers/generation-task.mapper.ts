import {
  checkpointPublicView,
  parseCheckpoint,
} from '../lib/generation-checkpoint';
import { requestJobDescription } from '../lib/request-job-description';

type GenerationInputRow = {
  id: string;
  status: string;
  request?: unknown;
  partialSections?: unknown;
  progress?: unknown;
  result?: unknown;
  error?: string | null;
  updatedAt?: Date | null;
};

export function mapGenerationTaskBody(input: GenerationInputRow) {
  const checkpoint = parseCheckpoint(input.progress, input.partialSections);
  const publicCheckpoint = checkpointPublicView(checkpoint);
  const terminal = input.status === 'completed' || input.status === 'failed';
  const canContinue = input.status === 'failed' || input.status === 'cancelled';
  return {
    httpStatus: terminal ? 200 : 202,
    body: {
      success: input.status !== 'failed',
      inputId: input.id,
      status: input.status,
      jobDescription: requestJobDescription(input.request),
      partialSections: input.partialSections || checkpoint.sections || {},
      progress: input.progress || null,
      checkpoint: publicCheckpoint,
      canContinue,
      failedStep: publicCheckpoint.failedStep,
      resumedFromStep: canContinue ? publicCheckpoint.nextStepIndex : null,
      result: input.result || null,
      error: input.error || checkpoint.error || null,
      updatedAt: input.updatedAt?.toISOString?.() ?? null,
    },
  };
}
