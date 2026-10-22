import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { mapPool } from '../../ai/concurrency/create-limiter';
import {
  JOB_SEARCH_RESUME_CONCURRENCY,
  RESUME_GENERATE_JOB_TIMEOUT_MS,
} from '../../ai/constants/ai-concurrency.constants';
import { BACKGROUND_TASK_STATUSES } from '../../background-tasks/constants/task-types';
import { TaskStoreService } from '../../background-tasks/task-store.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentJobResumesService } from '../agent-job-resumes.service';
import { cleanString } from './lib/clean-string';
import { createGenerationInput } from './lib/create-generation-input';
import { jobSkillNames } from './lib/job-skill-names';
import { raceDeadline } from './lib/race-deadline';
import {
  isAbortError,
  runStoredResumeGeneration,
} from './lib/run-stored-generation';
import { ResumeGenerateFinalizeService } from './resume-generate-finalize.service';
import { ResumeGenerateHydrateService } from './resume-generate-hydrate.service';
import { ResumeGeneratePipelineService } from './resume-generate-pipeline.service';
import { ResumeGeneratePrepareService } from './resume-generate-prepare.service';

@Injectable()
export class ResumeGenerateJobSearchService {
  private readonly logger = new Logger(ResumeGenerateJobSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hydrate: ResumeGenerateHydrateService,
    private readonly agentResumes: AgentJobResumesService,
    private readonly prepare: ResumeGeneratePrepareService,
    private readonly pipeline: ResumeGeneratePipelineService,
    private readonly finalize: ResumeGenerateFinalizeService,
  ) {}

  async process(
    task: {
      id: string;
      applierName?: string | null;
      profileId?: string | null;
    },
    store: TaskStoreService,
    signal: AbortSignal,
    jobIds: string[],
    forceRegenerate: boolean,
  ) {
    const applierName = cleanString(task.applierName);
    const items: Record<string, unknown> = Object.fromEntries(
      jobIds.map((id) => [id, { status: 'queued', step: null }]),
    );
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    const resultRecordIds: string[] = [];
    const completedJobIds: string[] = [];
    const failedJobIds: string[] = [];
    let gate = Promise.resolve();
    const locked = async (fn: () => Promise<void> | void) => {
      const run = gate.then(fn, fn);
      gate = run.then(
        () => undefined,
        () => undefined,
      );
      await run;
    };

    const report = async () => {
      const active = Object.values(items).filter(
        (item) => itemStatus(item) === 'running',
      ).length;
      await store.updateProgress(
        task.id,
        {
          total: jobIds.length,
          completed,
          failed,
          cancelled,
          active,
          remaining: Math.max(
            0,
            jobIds.length - completed - failed - cancelled,
          ),
          items,
          operation: 'job_search_resume_generation',
        },
        {
          status: signal.aborted
            ? BACKGROUND_TASK_STATUSES.CANCELLING
            : BACKGROUND_TASK_STATUSES.RUNNING,
        },
      );
    };

    const existing = forceRegenerate
      ? new Set<string>()
      : new Set((await this.agentResumes.status(applierName, jobIds)).jobIds);
    const jobs = jobIds.length
      ? await this.prisma.job.findMany({
          where: { id: { in: jobIds } },
          select: { id: true, description: true, aiSkills: true },
        })
      : [];
    const jobById = new Map(jobs.map((job) => [job.id, job]));

    await report();

    await mapPool(jobIds, JOB_SEARCH_RESUME_CONCURRENCY, async (jobId) => {
      if (signal.aborted) {
        await locked(async () => {
          cancelled += 1;
          items[jobId] = { status: 'cancelled', step: null };
          await report();
        });
        return;
      }
      if (existing.has(jobId)) {
        await locked(async () => {
          completed += 1;
          completedJobIds.push(jobId);
          items[jobId] = { status: 'completed', step: null, reused: true };
          await report();
        });
        return;
      }

      await locked(async () => {
        items[jobId] = {
          status: 'running',
          step: 'Preparing résumé generation…',
        };
        await report();
      });

      const job = jobById.get(jobId);
      const description = cleanString(job?.description);
      if (!description) {
        await locked(async () => {
          failed += 1;
          failedJobIds.push(jobId);
          items[jobId] = {
            status: 'failed',
            step: null,
            error: 'Job description is missing.',
          };
          await report();
        });
        return;
      }

      try {
        const hydrated = await this.hydrate.hydrate({
          applierName,
          profileId: cleanString(task.profileId) || undefined,
          jobDescription: description,
          jobSkills: jobSkillNames(job?.aiSkills),
          parentJobId: jobId,
        });
        const queued = await createGenerationInput(this.prisma, {
          applierName: hydrated.applierName,
          profileId: hydrated.profileId,
          requestId: forceRegenerate ? randomUUID() : `job:${jobId}`,
          request: hydrated.request,
        });
        const result = await raceDeadline(
          (jobSignal) =>
            runStoredResumeGeneration(
              {
                prisma: this.prisma,
                prepare: this.prepare,
                pipeline: this.pipeline,
                finalize: this.finalize,
              },
              task,
              queued.inputId,
              jobSignal,
              (step) => {
                void locked(async () => {
                  if (itemStatus(items[jobId]) !== 'running') return;
                  const previous =
                    items[jobId] && typeof items[jobId] === 'object'
                      ? (items[jobId] as Record<string, unknown>)
                      : {};
                  items[jobId] = { ...previous, status: 'running', ...step };
                  await report();
                });
              },
            ),
          RESUME_GENERATE_JOB_TIMEOUT_MS,
          signal,
        );
        await locked(async () => {
          completed += 1;
          completedJobIds.push(jobId);
          resultRecordIds.push(queued.inputId);
          items[jobId] = {
            status: 'completed',
            step: null,
            generationId: result.generationId || null,
            resultRecordId: queued.inputId,
            reused: result.recovered === true,
          };
          await report();
        });
      } catch (err) {
        await locked(async () => {
          const previous =
            items[jobId] && typeof items[jobId] === 'object'
              ? (items[jobId] as Record<string, unknown>)
              : {};
          if (isAbortError(err) || (signal.aborted && !isTimeoutError(err))) {
            cancelled += 1;
            items[jobId] = { ...previous, status: 'cancelled', step: null };
          } else {
            failed += 1;
            failedJobIds.push(jobId);
            items[jobId] = {
              ...previous,
              status: 'failed',
              step: null,
              error: err instanceof Error ? err.message : String(err),
            };
            this.logger.warn(
              `job résumé ${jobId} failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
          await report();
        });
      }
    });

    const status = signal.aborted
      ? BACKGROUND_TASK_STATUSES.CANCELLED
      : failed > 0
        ? BACKGROUND_TASK_STATUSES.COMPLETED_WITH_ERRORS
        : BACKGROUND_TASK_STATUSES.COMPLETED;
    await store.complete(
      task.id,
      { completedJobIds, failedJobIds, resultRecordIds },
      status,
    );
  }
}

function itemStatus(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  return String((item as { status?: unknown }).status || '');
}

function isTimeoutError(err: unknown): boolean {
  return Boolean(
    err &&
    typeof err === 'object' &&
    (err as { name?: string }).name === 'TimeoutError',
  );
}
