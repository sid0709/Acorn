import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MAIL_AI_LABEL_SCOPES } from '../../mail/constants/mail.constants';
import { MailAiLabelBacklogService } from '../../mail/mail-ai-label-backlog.service';
import { MailAiLabelService } from '../../mail/mail-ai-label.service';
import {
  compactLlmError,
  logMailAiLabel,
  mailAiLabelFailureClass,
} from '../../mail/mail-ai-label.parse';
import { MailCredentialsService } from '../../mail/mail-credentials.service';
import { JobWorkerPoolTaskService } from '../../jobs/job-worker-pool-task.service';
import { ResumeGenerateWorkerService } from '../../resumes/generator/resume-generate-worker.service';
import { BackgroundTasksService } from '../background-tasks.service';
import {
  BACKGROUND_TASK_STATUSES,
  BACKGROUND_TASK_TYPES,
  WORKER_HEARTBEAT_MS,
  backgroundWorkersMode,
} from '../constants/task-types';
import type { MailAiLabelProgress } from '../../mail/mail-ai-label.service';

@Injectable()
export class BackgroundTaskWorker implements OnModuleInit {
  private readonly logger = new Logger(BackgroundTaskWorker.name);
  private readonly workerId = `embedded-${randomUUID().slice(0, 8)}`;
  private running = false;
  private wakeAgain = false;
  private busy: { id: string; type: string } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly tasks: BackgroundTasksService,
    private readonly mailCreds: MailCredentialsService,
    private readonly aiLabel: MailAiLabelService,
    private readonly aiLabelBacklog: MailAiLabelBacklogService,
    @Inject(forwardRef(() => ResumeGenerateWorkerService))
    private readonly resumeGen: ResumeGenerateWorkerService,
    @Inject(forwardRef(() => JobWorkerPoolTaskService))
    private readonly workerPoolTask: JobWorkerPoolTaskService,
  ) {}

  onModuleInit() {
    const mode = backgroundWorkersMode();
    if (mode === 'off') {
      this.tasks.setWorkerHealthy(false);
      this.logger.warn(
        'Background worker disabled via BACKGROUND_WORKERS_MODE',
      );
      return;
    }
    this.tasks.setWorkerHealthy(true);
    this.tasks.setWakeHandler(() => this.wake());
    this.timer = setInterval(() => {
      void this.tick();
    }, WORKER_HEARTBEAT_MS);
    this.timer.unref?.();
    void this.tick();
    this.logger.log(`Background worker started (${this.workerId})`);
  }

  wake() {
    logMailAiLabel(this.logger, 'wake', {
      worker: this.workerId,
      running: this.running,
      busyType: this.busy?.type || 'idle',
      busyId: this.busy?.id || '-',
    });
    if (this.running) {
      this.wakeAgain = true;
      return;
    }
    void this.tick();
  }

  private async tick() {
    if (this.running) {
      this.wakeAgain = true;
      return;
    }
    this.running = true;
    this.wakeAgain = false;
    try {
      const store = this.tasks.getStore();
      for (;;) {
        const task =
          (await store.claimNext(
            this.workerId,
            BACKGROUND_TASK_TYPES.MAIL_AI_LABEL,
          )) ||
          (await store.claimNext(
            this.workerId,
            BACKGROUND_TASK_TYPES.RESUME_GENERATION,
          )) ||
          (await store.claimNext(
            this.workerId,
            BACKGROUND_TASK_TYPES.JOB_WORKER_POOL,
          ));
        if (!task) return;
        this.busy = { id: task.id, type: task.type };
        logMailAiLabel(this.logger, 'claim', {
          worker: this.workerId,
          type: task.type,
          taskId: task.id,
        });
        if (task.type === BACKGROUND_TASK_TYPES.RESUME_GENERATION) {
          await this.processResumeGeneration(task.id);
        } else if (task.type === BACKGROUND_TASK_TYPES.JOB_WORKER_POOL) {
          await this.processJobWorkerPool(task.id);
        } else {
          await this.processMailAiLabel(task.id);
        }
        this.busy = null;
      }
    } catch (err) {
      this.logger.error(
        `Worker tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.busy = null;
      this.running = false;
      if (this.wakeAgain) void this.tick();
    }
  }

  private async processResumeGeneration(taskId: string) {
    const store = this.tasks.getStore();
    const task = await store.findById(taskId);
    if (!task) return;

    const abort = new AbortController();
    const heartbeat = setInterval(() => {
      void store.heartbeat(taskId, this.workerId);
      void store.findById(taskId).then((fresh) => {
        if (fresh?.status === BACKGROUND_TASK_STATUSES.CANCELLING) {
          abort.abort();
        }
      });
    }, WORKER_HEARTBEAT_MS);

    try {
      await this.resumeGen.processTask(task, store, abort.signal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.complete(
        taskId,
        {},
        abort.signal.aborted
          ? BACKGROUND_TASK_STATUSES.CANCELLED
          : BACKGROUND_TASK_STATUSES.FAILED,
        message,
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async processJobWorkerPool(taskId: string) {
    const store = this.tasks.getStore();
    const task = await store.findById(taskId);
    if (!task) return;

    const abort = new AbortController();
    const heartbeat = setInterval(() => {
      void store.heartbeat(taskId, this.workerId);
      void store.findById(taskId).then((fresh) => {
        if (fresh?.status === BACKGROUND_TASK_STATUSES.CANCELLING) {
          abort.abort();
        }
      });
    }, WORKER_HEARTBEAT_MS);

    try {
      await this.workerPoolTask.processTask(task, store, abort.signal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.complete(
        taskId,
        {},
        abort.signal.aborted
          ? BACKGROUND_TASK_STATUSES.CANCELLED
          : BACKGROUND_TASK_STATUSES.FAILED,
        message,
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async processMailAiLabel(taskId: string) {
    const store = this.tasks.getStore();
    const task = await store.findById(taskId);
    if (!task) return;

    const abort = new AbortController();
    const heartbeat = setInterval(() => {
      void store.heartbeat(taskId, this.workerId);
      void store.findById(taskId).then((fresh) => {
        if (fresh?.status === BACKGROUND_TASK_STATUSES.CANCELLING) {
          abort.abort();
        }
      });
    }, WORKER_HEARTBEAT_MS);

    try {
      const applierName = String(task.applierName || '');
      const creds = await this.mailCreds.resolve(applierName);
      if (!creds.ok) {
        await store.complete(
          taskId,
          {},
          BACKGROUND_TASK_STATUSES.FAILED,
          creds.error,
        );
        return;
      }

      const payload =
        task.payload && typeof task.payload === 'object'
          ? (task.payload as {
              scope?: string;
              limit?: number;
              messageIds?: string[];
            })
          : {};
      const onProgress = async (progress: MailAiLabelProgress) => {
        await store.updateProgress(taskId, progress, {
          status: abort.signal.aborted
            ? BACKGROUND_TASK_STATUSES.CANCELLING
            : BACKGROUND_TASK_STATUSES.RUNNING,
        });
      };

      const batch =
        payload.scope === MAIL_AI_LABEL_SCOPES.UNLABELED_BACKLOG
          ? await this.aiLabelBacklog.run({
              creds,
              limit: payload.limit,
              signal: abort.signal,
              onProgress,
            })
          : await this.aiLabel.runBatch({
              creds,
              messageIds: Array.isArray(payload.messageIds)
                ? payload.messageIds.map(String)
                : [],
              signal: abort.signal,
              onProgress,
            });

      // Backlog runs trim retained detail rows, so trust the aggregate when the
      // runner reports one.
      const aggregateFailed = (
        batch.processing as { failed?: number } | undefined
      )?.failed;
      const failed =
        typeof aggregateFailed === 'number'
          ? aggregateFailed
          : batch.results.filter((r: { error?: string }) => r.error).length;
      const status = abort.signal.aborted
        ? BACKGROUND_TASK_STATUSES.CANCELLED
        : failed > 0
          ? BACKGROUND_TASK_STATUSES.COMPLETED_WITH_ERRORS
          : BACKGROUND_TASK_STATUSES.COMPLETED;

      await store.complete(
        taskId,
        { ...batch, workerId: this.workerId },
        status,
      );
      this.logger.log(
        `mail_ai_label ${taskId} ${status} worker=${this.workerId} class=${mailAiLabelFailureClass(batch.results)} applied=${batch.results.filter((r: { applied?: boolean }) => r.applied).length}/${Array.isArray(batch.results) ? batch.results.length : 0} error=${compactLlmError(batch.results.find((r: { error?: string }) => r.error)?.error || 'none')}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failureClass =
        /imap|socket timeout|gmail|ECONN|ENOTFOUND|auth/i.test(message)
          ? 'gmail_imap'
          : /model|openai|anthropic|llm|quota/i.test(message)
            ? 'llm_classify'
            : 'mixed';
      this.logger.warn(
        `mail_ai_label ${taskId} failed class=${failureClass} error=${compactLlmError(message)}`,
      );
      await store.complete(
        taskId,
        {},
        abort.signal.aborted
          ? BACKGROUND_TASK_STATUSES.CANCELLED
          : BACKGROUND_TASK_STATUSES.FAILED,
        message,
      );
    } finally {
      clearInterval(heartbeat);
    }
  }
}
