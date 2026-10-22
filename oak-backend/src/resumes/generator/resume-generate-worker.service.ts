import { Injectable, Logger } from '@nestjs/common';
import { BACKGROUND_TASK_STATUSES } from '../../background-tasks/constants/task-types';
import { TaskStoreService } from '../../background-tasks/task-store.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isAbortError,
  runStoredResumeGeneration,
} from './lib/run-stored-generation';
import { ResumeGenerateFinalizeService } from './resume-generate-finalize.service';
import { ResumeGenerateJobSearchService } from './resume-generate-job-search.service';
import { ResumeGeneratePipelineService } from './resume-generate-pipeline.service';
import { ResumeGeneratePrepareService } from './resume-generate-prepare.service';

@Injectable()
export class ResumeGenerateWorkerService {
  private readonly logger = new Logger(ResumeGenerateWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prepare: ResumeGeneratePrepareService,
    private readonly pipeline: ResumeGeneratePipelineService,
    private readonly finalize: ResumeGenerateFinalizeService,
    private readonly jobSearch: ResumeGenerateJobSearchService,
  ) {}

  async processTask(
    task: {
      id: string;
      applierName?: string | null;
      profileId?: string | null;
      payload?: unknown;
    },
    store: TaskStoreService,
    signal: AbortSignal,
  ) {
    const payload =
      task.payload && typeof task.payload === 'object'
        ? (task.payload as {
            requestRecordIds?: string[];
            jobIds?: string[];
            forceRegenerate?: boolean;
          })
        : {};
    const jobIds = Array.isArray(payload.jobIds)
      ? payload.jobIds.map(String).filter(Boolean)
      : [];
    if (jobIds.length) {
      await this.jobSearch.process(
        task,
        store,
        signal,
        jobIds,
        payload.forceRegenerate === true,
      );
      return;
    }
    const requestRecordIds = Array.isArray(payload.requestRecordIds)
      ? payload.requestRecordIds.map(String).filter(Boolean)
      : [];

    const items: Record<string, unknown> = Object.fromEntries(
      requestRecordIds.map((id) => [id, { status: 'queued', step: null }]),
    );
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    const resultRecordIds: string[] = [];

    const report = async () => {
      await store.updateProgress(
        task.id,
        {
          total: requestRecordIds.length,
          completed,
          failed,
          cancelled,
          active: 0,
          remaining: Math.max(
            0,
            requestRecordIds.length - completed - failed - cancelled,
          ),
          items,
          operation: 'editor_generation',
          inputId: requestRecordIds[0] || null,
        },
        {
          status: signal.aborted
            ? BACKGROUND_TASK_STATUSES.CANCELLING
            : BACKGROUND_TASK_STATUSES.RUNNING,
        },
      );
    };

    await report();

    for (const inputId of requestRecordIds) {
      if (signal.aborted) {
        cancelled += 1;
        items[inputId] = { status: 'cancelled', step: null };
        continue;
      }
      items[inputId] = {
        status: 'running',
        step: 'Preparing résumé generation…',
      };
      await report();
      try {
        const result = await runStoredResumeGeneration(
          {
            prisma: this.prisma,
            prepare: this.prepare,
            pipeline: this.pipeline,
            finalize: this.finalize,
          },
          task,
          inputId,
          signal,
          (step) => {
            const previous =
              items[inputId] && typeof items[inputId] === 'object'
                ? (items[inputId] as Record<string, unknown>)
                : {};
            const priorSteps = Array.isArray(previous.generationSteps)
              ? [...(previous.generationSteps as unknown[])]
              : [];
            const stepEvent =
              step.stepEvent && typeof step.stepEvent === 'object'
                ? (step.stepEvent as Record<string, unknown>)
                : null;
            if (stepEvent) {
              const idx = Number(stepEvent.index);
              const without = priorSteps.filter((entry) => {
                if (!entry || typeof entry !== 'object') return true;
                return Number((entry as { index?: unknown }).index) !== idx;
              });
              priorSteps.splice(0, priorSteps.length, ...without, stepEvent);
            }
            items[inputId] = {
              ...previous,
              status: 'running',
              ...step,
              generationSteps: priorSteps,
              stepRevision: Number(previous.stepRevision || 0) + 1,
            };
            void report();
          },
        );
        completed += 1;
        resultRecordIds.push(inputId);
        items[inputId] = {
          status: 'completed',
          step: null,
          generationId: result.generationId || null,
          resultRecordId: inputId,
          recovered: result.recovered === true,
          generationSteps: Array.isArray(
            (items[inputId] as { generationSteps?: unknown })?.generationSteps,
          )
            ? (items[inputId] as { generationSteps: unknown[] }).generationSteps
            : [],
          stepRevision:
            Number(
              (items[inputId] as { stepRevision?: unknown })?.stepRevision || 0,
            ) + 1,
        };
      } catch (err) {
        const previous =
          items[inputId] && typeof items[inputId] === 'object'
            ? (items[inputId] as Record<string, unknown>)
            : {};
        if (isAbortError(err) || signal.aborted) {
          cancelled += 1;
          items[inputId] = { ...previous, status: 'cancelled', step: null };
        } else {
          failed += 1;
          items[inputId] = {
            ...previous,
            status: 'failed',
            step: null,
            error: err instanceof Error ? err.message : String(err),
          };
          this.logger.warn(
            `stored generation ${inputId} failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      await report();
    }

    const status = signal.aborted
      ? BACKGROUND_TASK_STATUSES.CANCELLED
      : failed > 0
        ? BACKGROUND_TASK_STATUSES.COMPLETED_WITH_ERRORS
        : BACKGROUND_TASK_STATUSES.COMPLETED;

    await store.complete(
      task.id,
      { completedJobIds: [], failedJobIds: [], resultRecordIds },
      status,
    );
  }
}
