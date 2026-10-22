import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { AccountInfoService } from '../../auth/account-info.service';
import { BackgroundTasksService } from '../../background-tasks/background-tasks.service';
import { BACKGROUND_TASK_TYPES } from '../../background-tasks/constants/task-types';
import {
  rawUpdateMany,
  withReplicaSetFallback,
} from '../../prisma/mongo-standalone';
import { PrismaService } from '../../prisma/prisma.service';
import { cleanString } from './lib/clean-string';
import { createGenerationInput } from './lib/create-generation-input';
import { ResumeGenerateHydrateService } from './resume-generate-hydrate.service';

const INPUTS_COLLECTION = 'background_task_inputs';

@Injectable()
export class ResumeGenerateEnqueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountInfoService,
    private readonly hydrate: ResumeGenerateHydrateService,
    @Inject(forwardRef(() => BackgroundTasksService))
    private readonly backgroundTasks: BackgroundTasksService,
  ) {}

  async enqueue(body: Record<string, unknown>) {
    const applierName = cleanString(body.applierName);
    const jobDescription = cleanString(body.jobDescription);
    if (!applierName) {
      throw new BadRequestException({
        success: false,
        error: 'applierName is required',
      });
    }
    if (!jobDescription) {
      throw new BadRequestException({
        success: false,
        error: 'jobDescription is required',
      });
    }

    const hydrated = await this.hydrate.hydrate({
      applierName,
      profileId: cleanString(body.profileId) || undefined,
      jobDescription,
      jobSkills: Array.isArray(body.jobSkills)
        ? body.jobSkills.map((skill) => String(skill))
        : undefined,
      parentJobId: cleanString(body.parentJobId) || undefined,
    });
    const account = await this.accounts.findByName(hydrated.applierName);
    const requestId = cleanString(body.requestId) || randomUUID();
    const queued = await createGenerationInput(this.prisma, {
      applierName: hydrated.applierName,
      profileId: hydrated.profileId,
      requestId,
      request: hydrated.request,
    });

    try {
      const task = await this.backgroundTasks.create({
        requestId,
        type: BACKGROUND_TASK_TYPES.RESUME_GENERATION,
        profileId: queued.profileId,
        applierName: account?.name || hydrated.applierName,
        payload: { requestRecordIds: [queued.inputId] },
        progress: {
          total: 1,
          operation: 'editor_generation',
          inputId: queued.inputId,
        },
      });
      return { ...task, inputId: queued.inputId };
    } catch (error) {
      const failMessage =
        error instanceof Error ? error.message : String(error);
      await withReplicaSetFallback(
        () =>
          this.prisma.backgroundTaskInput.updateMany({
            where: { id: queued.inputId, status: 'queued' },
            data: { status: 'failed', error: failMessage },
          }),
        async () => {
          await rawUpdateMany(
            this.prisma,
            INPUTS_COLLECTION,
            { _id: queued.inputId, status: 'queued' },
            {
              status: 'failed',
              error: failMessage,
              updatedAt: new Date(),
            },
          );
          return { count: 0 };
        },
      ).catch(() => undefined);
      throw error;
    }
  }
}
