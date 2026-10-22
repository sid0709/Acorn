import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AccountInfoService } from '../auth/account-info.service';
import { MailCredentialsService } from '../mail/mail-credentials.service';
import {
  BACKGROUND_TASK_STATUSES,
  BACKGROUND_TASK_TYPES,
  WORKER_HEALTH_PROBE_TTL_MS,
  backgroundWorkersMode,
} from './constants/task-types';
import { initialTaskProgress, normalizeTaskPayload } from './task-payload';
import { TaskStoreService } from './task-store.service';

@Injectable()
export class BackgroundTasksService {
  private readonly logger = new Logger(BackgroundTasksService.name);
  private workerHealthy = false;
  private probe: { at: number; ok: boolean } | null = null;
  private wakeHandler: (() => void) | null = null;

  constructor(
    private readonly store: TaskStoreService,
    private readonly accounts: AccountInfoService,
    private readonly mailCreds: MailCredentialsService,
  ) {}

  setWorkerHealthy(ok: boolean) {
    this.workerHealthy = ok;
  }

  setWakeHandler(handler: () => void) {
    this.wakeHandler = handler;
  }

  async isWorkerHealthy(): Promise<boolean> {
    const mode = backgroundWorkersMode();
    if (mode === 'embedded' || mode === 'worker') return this.workerHealthy;
    return this.probeSplitWorker();
  }

  async create(input: {
    requestId?: string;
    type: string;
    profileId?: string;
    applierName?: string;
    payload?: Record<string, unknown>;
    progress?: Record<string, unknown>;
  }) {
    const allowed = (Object.values(BACKGROUND_TASK_TYPES) as string[]).includes(
      input.type,
    );
    if (!allowed) {
      throw new BadRequestException(
        `Unsupported background task type: ${input.type}`,
      );
    }
    if (!(await this.isWorkerHealthy())) {
      throw new ServiceUnavailableException({
        success: false,
        error: 'BACKGROUND_WORKER_UNAVAILABLE',
        message: 'Background worker is not available',
      });
    }

    const applierName = String(input.applierName || '').trim();
    if (!applierName) {
      throw new BadRequestException('applierName is required');
    }

    const account = await this.accounts.findByName(applierName);
    if (!account) throw new NotFoundException('Account not found');

    if (
      input.type === BACKGROUND_TASK_TYPES.MAIL_AI_LABEL &&
      !this.mailCreds.isBeta(account.tier)
    ) {
      throw new BadRequestException('Beta access required for mail_ai_label');
    }

    if (input.requestId) {
      const existing = await this.store.findByRequestId(input.requestId);
      if (existing) {
        return {
          success: true,
          created: false,
          duplicate: true,
          task: this.store.toPublic(existing),
        };
      }
      const reserved = await this.store.reserve(
        `request:${input.requestId}`,
        'pending',
      );
      if (!reserved) {
        const again = await this.store.findByRequestId(input.requestId);
        if (again) {
          return {
            success: true,
            created: false,
            duplicate: true,
            task: this.store.toPublic(again),
          };
        }
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = normalizeTaskPayload(input.type, input.payload);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }

    const task = await this.store.create({
      requestId: input.requestId,
      type: input.type,
      profileId: input.profileId || account.id,
      applierName: account.name,
      payload,
      progress: input.progress || initialTaskProgress(input.type, payload),
    });

    if (input.requestId) {
      await this.store.reserve(`request:${input.requestId}`, task.id);
    }

    this.wakeHandler?.();

    return {
      success: true,
      created: true,
      task: this.store.toPublic(task),
    };
  }

  async list(opts: { profileId?: string; active?: boolean; limit?: number }) {
    const tasks = await this.store.list(opts);
    return {
      success: true,
      tasks: tasks.map((t) => this.store.toPublic(t)),
    };
  }

  async get(taskId: string) {
    const task = await this.store.findById(taskId);
    if (!task) throw new NotFoundException('Task not found');
    return { success: true, task: this.store.toPublic(task) };
  }

  async cancel(taskId: string) {
    const task = await this.store.requestCancel(taskId);
    if (!task) throw new NotFoundException('Task not found');
    return { success: true, task: this.store.toPublic(task) };
  }

  getStore() {
    return this.store;
  }

  private async probeSplitWorker(): Promise<boolean> {
    const now = Date.now();
    if (this.probe && now - this.probe.at < WORKER_HEALTH_PROBE_TTL_MS) {
      return this.probe.ok;
    }
    const urls = [
      String(
        process.env.WORKER_HEALTH_URL || 'http://127.0.0.1:8981/readyz',
      ).trim(),
      'http://127.0.0.1:8981/readyz',
      'http://127.0.0.1:8981/healthz',
    ].filter((url, index, list) => url && list.indexOf(url) === index);
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(2000),
          headers: { 'user-agent': 'athens-worker-health/1.0' },
        });
        if (response.ok) {
          this.probe = { at: now, ok: true };
          return true;
        }
      } catch {
        /* try next */
      }
    }
    this.logger.warn(
      `Worker health probe failed (${urls.join(', ')}). Background tasks stay degraded until :8981 answers.`,
    );
    this.probe = { at: now, ok: false };
    return false;
  }
}
