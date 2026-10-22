import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { BACKGROUND_TASK_TYPES } from '../../../background-tasks/constants/task-types';
import {
  rawInsertOne,
  withReplicaSetFallback,
} from '../../../prisma/mongo-standalone';
import { PrismaService } from '../../../prisma/prisma.service';
import { BACKGROUND_INPUT_RETENTION_MS } from '../constants/generator.constants';

const INPUTS_COLLECTION = 'background_task_inputs';

export type QueuedGenerationInput = {
  inputId: string;
  requestId: string;
  profileId: string;
  applierName: string;
};

/** Persist one idempotent generation request row. */
export async function createGenerationInput(
  prisma: PrismaService,
  input: {
    applierName: string;
    profileId: string;
    request?: Record<string, unknown>;
    requestId?: string;
  },
): Promise<QueuedGenerationInput> {
  const requestId = String(input.requestId || '').trim() || randomUUID();
  const inputId = createHash('sha256')
    .update(`${input.profileId}\0${requestId}\0resume-generation`)
    .digest('hex');
  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + BACKGROUND_INPUT_RETENTION_MS,
  );
  const request = (input.request ?? {}) as Prisma.InputJsonValue;

  try {
    await withReplicaSetFallback(
      () =>
        prisma.backgroundTaskInput.create({
          data: {
            id: inputId,
            kind: BACKGROUND_TASK_TYPES.RESUME_GENERATION,
            requestId,
            profileId: input.profileId,
            applierName: input.applierName,
            status: 'queued',
            request,
            partialSections: {},
            progress: {},
            createdAt,
            expiresAt,
          },
        }),
      async () => {
        await rawInsertOne(prisma, INPUTS_COLLECTION, {
          _id: inputId,
          kind: BACKGROUND_TASK_TYPES.RESUME_GENERATION,
          requestId,
          profileId: input.profileId,
          applierName: input.applierName,
          status: 'queued',
          request,
          partialSections: {},
          progress: {},
          result: null,
          error: null,
          workerTaskId: null,
          createdAt,
          startedAt: null,
          finishedAt: null,
          updatedAt: createdAt,
          expiresAt,
        });
        return null;
      },
    );
  } catch {
    /* duplicate input id — reuse existing row */
  }

  return {
    inputId,
    requestId,
    profileId: input.profileId,
    applierName: input.applierName,
  };
}
