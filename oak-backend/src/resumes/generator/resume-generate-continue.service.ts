import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { AccountInfoService } from '../../auth/account-info.service';
import { BackgroundTasksService } from '../../background-tasks/background-tasks.service';
import { BACKGROUND_TASK_TYPES } from '../../background-tasks/constants/task-types';
import { PrismaService } from '../../prisma/prisma.service';
import { cleanString } from './lib/clean-string';
import {
  nextIncompleteIndex,
  parseCheckpoint,
} from './lib/generation-checkpoint';
import { patchGenerationInput } from './lib/run-stored-generation';
import { requestJobDescription } from './lib/request-job-description';

const CONTINUABLE = new Set(['failed', 'cancelled']);

@Injectable()
export class ResumeGenerateContinueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountInfoService,
    @Inject(forwardRef(() => BackgroundTasksService))
    private readonly backgroundTasks: BackgroundTasksService,
  ) {}

  async continue(input: { inputId: string; applierName: string }) {
    const inputId = cleanString(input.inputId);
    const applierName = cleanString(input.applierName);
    const row = await this.prisma.backgroundTaskInput.findUnique({
      where: { id: inputId },
    });
    if (!row) {
      throw new NotFoundException({
        success: false,
        error: 'Resume generation input not found',
      });
    }
    if (
      applierName &&
      applierName.toLocaleLowerCase('en-US') !==
        String(row.applierName || '').toLocaleLowerCase('en-US')
    ) {
      throw new ForbiddenException({
        success: false,
        error: 'Resume generation access denied',
      });
    }
    if (row.status === 'completed' && row.result) {
      return {
        success: true as const,
        created: false as const,
        recovered: true as const,
        inputId: row.id,
        resumedFromStep: null,
        jobDescription: requestJobDescription(row.request),
        task: null,
      };
    }
    if (row.status === 'queued' || row.status === 'running') {
      throw new ConflictException({
        success: false,
        error: 'Resume generation is already in progress',
      });
    }
    if (!CONTINUABLE.has(String(row.status || ''))) {
      throw new ConflictException({
        success: false,
        error: `Cannot continue generation in status ${row.status}`,
      });
    }

    const checkpoint = parseCheckpoint(row.progress, row.partialSections);
    const resumedFromStep = nextIncompleteIndex(checkpoint);
    await patchGenerationInput(this.prisma, row.id, {
      status: 'queued',
      error: null,
      finishedAt: null,
      workerTaskId: null,
    });

    const account = await this.accounts.findByName(
      String(row.applierName || applierName),
    );
    const queued = await this.backgroundTasks.create({
      requestId: randomUUID(),
      type: BACKGROUND_TASK_TYPES.RESUME_GENERATION,
      profileId: row.profileId || undefined,
      applierName: account?.name || row.applierName || applierName,
      payload: { requestRecordIds: [row.id] },
      progress: {
        total: 1,
        operation: 'editor_generation',
        inputId: row.id,
        resumedFromStep,
      },
    });
    return {
      success: true as const,
      created: true as const,
      recovered: false as const,
      inputId: row.id,
      resumedFromStep,
      jobDescription: requestJobDescription(row.request),
      task: queued.task,
    };
  }
}
