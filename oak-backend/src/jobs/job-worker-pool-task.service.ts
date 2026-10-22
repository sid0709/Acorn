import { Injectable } from '@nestjs/common';
import { BACKGROUND_TASK_STATUSES } from '../background-tasks/constants/task-types';
import { PrismaService } from '../prisma/prisma.service';
import { JobCompanyApplyOthersService } from './job-company-apply-others.service';
import { JobWorkerPoolService } from './job-worker-pool.service';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

type ItemState = {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
};

type TaskStore = {
  updateProgress(
    id: string,
    progress: Record<string, unknown>,
    patch?: { status?: string },
  ): Promise<unknown>;
  complete(
    id: string,
    result: Record<string, unknown>,
    status:
      | typeof BACKGROUND_TASK_STATUSES.COMPLETED
      | typeof BACKGROUND_TASK_STATUSES.COMPLETED_WITH_ERRORS
      | typeof BACKGROUND_TASK_STATUSES.FAILED
      | typeof BACKGROUND_TASK_STATUSES.CANCELLED,
    error?: string,
  ): Promise<unknown>;
};

/** Moves selected jobs to Worker pool, then marks other company roles applied. */
@Injectable()
export class JobWorkerPoolTaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workerPool: JobWorkerPoolService,
    private readonly applyOthers: JobCompanyApplyOthersService,
  ) {}

  async processTask(
    task: { id: string; applierName?: string | null; payload?: unknown },
    store: TaskStore,
    signal: AbortSignal,
  ) {
    const applierName = String(task.applierName || '').trim();
    const raw =
      task.payload && typeof task.payload === 'object'
        ? (task.payload as { jobIds?: unknown; applyAllCompanyRoles?: unknown })
        : {};
    const jobIds = Array.isArray(raw.jobIds)
      ? [
          ...new Set(
            raw.jobIds.map((id) => String(id || '').trim()).filter(Boolean),
          ),
        ]
      : [];
    const applyAll = raw.applyAllCompanyRoles === true;
    const items: Record<string, ItemState> = Object.fromEntries(
      jobIds.map((id) => [id, { status: 'queued' as const }]),
    );
    const workerPoolIds: string[] = [];
    const appliedIds: string[] = [];
    let completed = 0;
    let failed = 0;

    const report = (phase: string) =>
      store.updateProgress(
        task.id,
        {
          total: jobIds.length,
          completed,
          failed,
          remaining: Math.max(0, jobIds.length - completed - failed),
          active: signal.aborted ? 0 : 1,
          phase,
          appliedIds,
          items,
        },
        {
          status: signal.aborted
            ? BACKGROUND_TASK_STATUSES.CANCELLING
            : BACKGROUND_TASK_STATUSES.RUNNING,
        },
      );

    const rows = jobIds.length
      ? await this.prisma.job.findMany({
          where: { id: { in: jobIds } },
          select: { id: true, companyId: true },
        })
      : [];
    const companyByJob = new Map(
      rows.map((row) => [row.id, String(row.companyId || '').trim()]),
    );
    const groups = groupKeepIds(jobIds, companyByJob);

    await report('worker-pool');
    for (const group of groups) {
      if (signal.aborted) break;
      for (const jobId of group.keepJobIds) {
        if (signal.aborted) break;
        if (!companyByJob.has(jobId)) {
          items[jobId] = { status: 'failed', error: 'Job not found' };
          failed += 1;
          await report('worker-pool');
          continue;
        }
        try {
          await this.workerPool.setStatus(jobId, applierName, 'WorkerPool');
          items[jobId] = { status: 'completed' };
          workerPoolIds.push(jobId);
          completed += 1;
        } catch (err) {
          items[jobId] = {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          };
          failed += 1;
        }
        await report('worker-pool');
      }
      if (applyAll && !signal.aborted) {
        try {
          const res = await this.applyOthers.applyOthers({
            applierName,
            companyId: group.companyId,
            keepJobIds: group.keepJobIds,
          });
          appliedIds.push(...(res.appliedIds || []));
          await report('siblings');
        } catch {
          await report('siblings');
        }
      }
    }

    if (signal.aborted) {
      for (const id of jobIds) {
        if (items[id]?.status === 'queued' || items[id]?.status === 'running') {
          items[id] = { status: 'cancelled' };
        }
      }
    }

    const status = signal.aborted
      ? BACKGROUND_TASK_STATUSES.CANCELLED
      : failed > 0
        ? BACKGROUND_TASK_STATUSES.COMPLETED_WITH_ERRORS
        : BACKGROUND_TASK_STATUSES.COMPLETED;
    await store.complete(
      task.id,
      { workerPoolIds, appliedIds, failedCount: failed },
      status,
    );
  }
}

function groupKeepIds(
  jobIds: string[],
  companyByJob: Map<string, string>,
): Array<{ companyId: string; keepJobIds: string[] }> {
  const order: string[] = [];
  const keep = new Map<string, string[]>();
  for (const jobId of jobIds) {
    const companyId = companyByJob.get(jobId) || '';
    const key = OBJECT_ID_RE.test(companyId) ? companyId : `keep:${jobId}`;
    const list = keep.get(key);
    if (list) list.push(jobId);
    else {
      keep.set(key, [jobId]);
      order.push(key);
    }
  }
  return order.map((key) => ({
    companyId: key.startsWith('keep:') ? keep.get(key)?.[0] || key : key,
    keepJobIds: keep.get(key) || [],
  }));
}
