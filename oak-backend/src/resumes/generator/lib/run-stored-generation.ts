import type { Prisma } from '@prisma/client';
import {
  rawUpdateMany,
  withReplicaSetFallback,
} from '../../../prisma/mongo-standalone';
import { PrismaService } from '../../../prisma/prisma.service';
import { cleanString } from './clean-string';
import { sectionContentMissing } from './assert-generated-sections';
import type { GenerationStepEvent } from './generation-step-event';
import { ResumeGenerateFinalizeService } from '../resume-generate-finalize.service';
import { ResumeGeneratePipelineService } from '../resume-generate-pipeline.service';
import { ResumeGeneratePrepareService } from '../resume-generate-prepare.service';
import {
  markCheckpointFailure,
  parseCheckpoint,
  recordCheckpointProgress,
} from './generation-checkpoint';
import { asJsonObject } from './generation-progress';

const INPUTS_COLLECTION = 'background_task_inputs';

export type StoredGenerationTask = {
  id: string;
  applierName?: string | null;
  profileId?: string | null;
};

/** Run one BackgroundTaskInput through prepare → pipeline → finalize. */
export async function runStoredResumeGeneration(
  deps: {
    prisma: PrismaService;
    prepare: ResumeGeneratePrepareService;
    pipeline: ResumeGeneratePipelineService;
    finalize: ResumeGenerateFinalizeService;
  },
  task: StoredGenerationTask,
  inputId: string,
  signal: AbortSignal,
  onStep: (step: Record<string, unknown>) => void,
): Promise<{ generationId: string | null; recovered: boolean }> {
  const { prisma, prepare, pipeline, finalize } = deps;
  const input = await prisma.backgroundTaskInput.findUnique({
    where: { id: inputId },
  });
  if (!input) {
    throw Object.assign(new Error('Resume generation input not found'), {
      status: 404,
    });
  }
  if (input.status === 'completed' && input.result) {
    const recovered = input.result as { generationId?: string };
    return {
      generationId: recovered.generationId || null,
      recovered: true,
    };
  }

  throwIfAborted(signal);
  await patchGenerationInput(prisma, inputId, {
    status: 'running',
    workerTaskId: task.id,
    startedAt: input.startedAt || new Date(),
    error: null,
  });

  const request =
    input.request && typeof input.request === 'object'
      ? (input.request as Record<string, unknown>)
      : {};
  const body: Record<string, unknown> = {
    ...request,
    applierName: task.applierName,
    profileId: input.profileId || task.profileId || request.profileId,
    backgroundTaskInputId: inputId,
  };

  const checkpoint = parseCheckpoint(input.progress, input.partialSections);
  let progressState: Record<string, unknown> = asJsonObject(input.progress);
  let sectionsState = asJsonObject(checkpoint.sections);
  let latestStep: GenerationStepEvent | null = null;
  let writeChain = Promise.resolve();

  const queueInputPatch = (data: Record<string, unknown>) => {
    const snap = data;
    writeChain = writeChain
      .then(async () => {
        throwIfAborted(signal);
        await patchGenerationInput(prisma, inputId, snap);
      })
      .catch((err) => {
        if (isAbortError(err) || signal.aborted) throw err;
      });
  };

  try {
    const prep = await prepare.prepare(body);
    throwIfAborted(signal);
    if (!prep.ok) {
      throw Object.assign(new Error(prep.error), { status: prep.status });
    }
    body.provider = prep.providerId;
    body.model = prep.model;

    const startedAt = new Date();
    const generated = await pipeline.runGeneration(
      prep,
      {
        systemInstruction: cleanString(body.systemInstruction) || undefined,
        identity:
          body.identity && typeof body.identity === 'object'
            ? (body.identity as Record<string, unknown>)
            : null,
        applierName: String(task.applierName || ''),
        jobDescription: cleanString(body.jobDescription) || undefined,
        jobSkills: Array.isArray(body.jobSkills) ? body.jobSkills : undefined,
        reasoningEffort: cleanString(body.reasoningEffort) || undefined,
        signal,
        checkpointSteps: checkpoint.steps,
      },
      (step: GenerationStepEvent) => {
        latestStep = step;
        progressState = recordCheckpointProgress(
          progressState,
          step,
          sectionsState,
        );
        const isFinalSection =
          step.phase === 'step-done' &&
          step.kind === 'final' &&
          step.purpose &&
          step.output != null &&
          !sectionContentMissing(cleanString(step.purpose), step.output);
        if (isFinalSection) {
          sectionsState = {
            ...sectionsState,
            [cleanString(step.purpose)]: step.output as Prisma.InputJsonValue,
          };
        }
        const progressSnap = progressState;
        const sectionsSnap = sectionsState;
        queueInputPatch(
          isFinalSection
            ? { progress: progressSnap, partialSections: sectionsSnap }
            : { progress: progressSnap },
        );
        onStep({
          step:
            step.phase === 'step-start'
              ? `Running: ${step.name || 'Step'}…`
              : `Completed: ${step.name || cleanString(step.purpose) || 'Step'}`,
          stepEvent: step,
        });
      },
    );
    throwIfAborted(signal);
    await writeChain;

    const finalized = await finalize.finalize({
      prep,
      body,
      result: generated,
      startedAt,
      signal,
    });

    const storedResult = {
      provider: prep.providerId,
      model: prep.model,
      sections: finalized.sections,
      perStep: generated.perStep,
      usage: finalized.usage,
      skillProfile: finalized.skillProfile,
      techStack: finalized.techStack,
      skillAnalysisError: finalized.skillAnalysisError,
      coverageContract: finalized.coverageContract,
      generationId: finalized.generationId
        ? String(finalized.generationId)
        : null,
      resumeId: finalized.resumeId ? String(finalized.resumeId) : null,
      isBeta: finalized.isBeta,
      dynamicCareerTitles: finalized.dynamicCareerTitles,
      titlePolicyFingerprint: finalized.titlePolicyFingerprint,
      titlePolicyVersion: finalized.titlePolicyVersion,
    };

    await patchGenerationInput(prisma, inputId, {
      status: 'completed',
      result: storedResult,
      error: null,
      finishedAt: new Date(),
    });

    return { generationId: storedResult.generationId, recovered: false };
  } catch (error) {
    await writeChain.catch(() => undefined);
    const failMessage =
      isAbortError(error) || signal.aborted
        ? null
        : error instanceof Error
          ? error.message
          : String(error);
    await patchGenerationInput(prisma, inputId, {
      status: isAbortError(error) || signal.aborted ? 'cancelled' : 'failed',
      error: failMessage,
      finishedAt: new Date(),
      ...(failMessage
        ? {
            progress: markCheckpointFailure(
              progressState,
              latestStep,
              failMessage,
              sectionsState,
            ),
            partialSections: sectionsState,
          }
        : {}),
    }).catch(() => undefined);
    throw error;
  }
}

export async function patchGenerationInput(
  prisma: PrismaService,
  id: string,
  data: Record<string, unknown>,
) {
  await withReplicaSetFallback(
    () =>
      prisma.backgroundTaskInput.update({
        where: { id },
        data: data,
      }),
    async () => {
      await rawUpdateMany(
        prisma,
        INPUTS_COLLECTION,
        { _id: id },
        {
          ...data,
          updatedAt: new Date(),
        },
      );
      return null;
    },
  );
}

export function isAbortError(err: unknown): boolean {
  return (
    Boolean(err) &&
    typeof err === 'object' &&
    ((err as { name?: string }).name === 'AbortError' ||
      (err as { code?: string }).code === 'ABORT_ERR')
  );
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw Object.assign(new Error('Resume generation cancelled'), {
    name: 'AbortError',
  });
}
