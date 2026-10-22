import { Injectable } from '@nestjs/common';
import type { BackgroundTask, Prisma } from '@prisma/client';
import {
  rawInsertOne,
  withReplicaSetFallback,
} from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';
import {
  BACKGROUND_TASK_STATUSES,
  BACKGROUND_TASK_TYPES,
  WORKER_LEASE_MS,
} from './constants/task-types';
import { publicTaskSnapshot } from './task-payload';

const BACKGROUND_TASKS_COLLECTION = 'background_tasks';
const RESERVATIONS_COLLECTION = 'background_task_reservations';

@Injectable()
export class TaskStoreService {
  constructor(private readonly prisma: PrismaService) {}

  toPublic(task: {
    id: string;
    requestId?: string | null;
    type: string;
    status: string;
    profileId?: string | null;
    applierName?: string | null;
    progress?: unknown;
    result?: unknown;
    error?: string | null;
    createdAt?: Date | null;
    startedAt?: Date | null;
    cancelRequestedAt?: Date | null;
    cancelAcknowledgedAt?: Date | null;
    finishedAt?: Date | null;
    updatedAt?: Date | null;
  }) {
    return publicTaskSnapshot(task);
  }

  async findById(id: string) {
    return this.prisma.backgroundTask.findUnique({ where: { id } });
  }

  async findByRequestId(requestId: string) {
    return this.prisma.backgroundTask.findFirst({
      where: { requestId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async list(opts: { profileId?: string; active?: boolean; limit?: number }) {
    const limit = Math.min(100, Math.max(1, opts.limit || 50));
    const where: Prisma.BackgroundTaskWhereInput = {};
    if (opts.profileId) where.profileId = opts.profileId;
    if (opts.active) {
      where.status = {
        in: [
          BACKGROUND_TASK_STATUSES.QUEUED,
          BACKGROUND_TASK_STATUSES.RUNNING,
          BACKGROUND_TASK_STATUSES.CANCELLING,
        ],
      };
    }
    return this.prisma.backgroundTask.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }

  async create(input: {
    requestId?: string;
    type: string;
    profileId?: string;
    applierName?: string;
    payload: Record<string, unknown>;
    progress?: Record<string, unknown>;
  }): Promise<BackgroundTask> {
    const now = new Date();
    const data = {
      requestId: input.requestId ?? null,
      type: input.type,
      status: BACKGROUND_TASK_STATUSES.QUEUED,
      profileId: input.profileId ?? null,
      applierName: input.applierName ?? null,
      payload: input.payload as Prisma.InputJsonValue,
      progress: (input.progress || {}) as Prisma.InputJsonValue,
      eventSequence: 0,
    };

    return withReplicaSetFallback(
      () =>
        this.prisma.backgroundTask.create({
          data: {
            requestId: data.requestId ?? undefined,
            type: data.type,
            status: data.status,
            profileId: data.profileId ?? undefined,
            applierName: data.applierName ?? undefined,
            payload: data.payload,
            progress: data.progress,
            eventSequence: 0,
          },
        }),
      async () => {
        await rawInsertOne(this.prisma, BACKGROUND_TASKS_COLLECTION, {
          ...data,
          result: null,
          error: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          createdAt: now,
          startedAt: null,
          cancelRequestedAt: null,
          cancelAcknowledgedAt: null,
          finishedAt: null,
          updatedAt: now,
        });
        const created = input.requestId
          ? await this.findByRequestId(input.requestId)
          : await this.prisma.backgroundTask.findFirst({
              where: {
                type: input.type,
                applierName: input.applierName,
                status: BACKGROUND_TASK_STATUSES.QUEUED,
              },
              orderBy: { createdAt: 'desc' },
            });
        if (!created) {
          throw new Error('Failed to load background_tasks after raw insert');
        }
        return created;
      },
    );
  }

  async reserve(key: string, taskId: string, ttlMs = 24 * 60 * 60 * 1000) {
    const now = new Date();
    const expiresAt = new Date(Date.now() + ttlMs);
    try {
      await withReplicaSetFallback(
        () =>
          this.prisma.backgroundTaskReservation.create({
            data: { key, taskId, expiresAt },
          }),
        async () => {
          await rawInsertOne(this.prisma, RESERVATIONS_COLLECTION, {
            key,
            taskId,
            expiresAt,
            createdAt: now,
          });
          return null;
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  async findReservation(key: string) {
    return this.prisma.backgroundTaskReservation.findUnique({ where: { key } });
  }

  async updateProgress(
    id: string,
    progress: Record<string, unknown>,
    patch: { status?: string; eventSequence?: number } = {},
  ) {
    return withReplicaSetFallback(
      () =>
        this.prisma.backgroundTask.update({
          where: { id },
          data: {
            progress: progress as Prisma.InputJsonValue,
            ...(patch.status ? { status: patch.status } : {}),
            eventSequence: { increment: 1 },
          },
        }),
      async () => {
        await this.rawPatch(id, {
          progress,
          ...(patch.status ? { status: patch.status } : {}),
        });
        return this.findById(id);
      },
    );
  }

  async complete(
    id: string,
    result: Record<string, unknown>,
    status:
      | typeof BACKGROUND_TASK_STATUSES.COMPLETED
      | typeof BACKGROUND_TASK_STATUSES.COMPLETED_WITH_ERRORS
      | typeof BACKGROUND_TASK_STATUSES.FAILED
      | typeof BACKGROUND_TASK_STATUSES.CANCELLED,
    error?: string,
  ) {
    return withReplicaSetFallback(
      () =>
        this.prisma.backgroundTask.update({
          where: { id },
          data: {
            status,
            result: result as Prisma.InputJsonValue,
            error: error || null,
            finishedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
            eventSequence: { increment: 1 },
          },
        }),
      async () => {
        await this.rawPatch(id, {
          status,
          result,
          error: error || null,
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        return this.findById(id);
      },
    );
  }

  async requestCancel(id: string) {
    const task = await this.findById(id);
    if (!task) return null;
    if (task.status === BACKGROUND_TASK_STATUSES.QUEUED) {
      return withReplicaSetFallback(
        () =>
          this.prisma.backgroundTask.update({
            where: { id },
            data: {
              status: BACKGROUND_TASK_STATUSES.CANCELLED,
              cancelRequestedAt: new Date(),
              finishedAt: new Date(),
              eventSequence: { increment: 1 },
            },
          }),
        async () => {
          await this.rawPatch(id, {
            status: BACKGROUND_TASK_STATUSES.CANCELLED,
            cancelRequestedAt: new Date(),
            finishedAt: new Date(),
          });
          return this.findById(id);
        },
      );
    }
    if (
      task.status === BACKGROUND_TASK_STATUSES.RUNNING ||
      task.status === BACKGROUND_TASK_STATUSES.CANCELLING
    ) {
      return withReplicaSetFallback(
        () =>
          this.prisma.backgroundTask.update({
            where: { id },
            data: {
              status: BACKGROUND_TASK_STATUSES.CANCELLING,
              cancelRequestedAt: new Date(),
              eventSequence: { increment: 1 },
            },
          }),
        async () => {
          await this.rawPatch(id, {
            status: BACKGROUND_TASK_STATUSES.CANCELLING,
            cancelRequestedAt: new Date(),
          });
          return this.findById(id);
        },
      );
    }
    return task;
  }

  async claimNext(workerId: string, type?: string) {
    const now = new Date();
    const candidates = await this.prisma.backgroundTask.findMany({
      where: {
        status: BACKGROUND_TASK_STATUSES.QUEUED,
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });
    for (const task of candidates) {
      try {
        const claimed = await withReplicaSetFallback(
          async () => {
            const updated = await this.prisma.backgroundTask.updateMany({
              where: {
                id: task.id,
                status: BACKGROUND_TASK_STATUSES.QUEUED,
              },
              data: {
                status: BACKGROUND_TASK_STATUSES.RUNNING,
                startedAt: now,
                leaseOwner: workerId,
                leaseExpiresAt: new Date(Date.now() + WORKER_LEASE_MS),
                eventSequence: { increment: 1 },
              },
            });
            return updated.count === 1;
          },
          async () => {
            const result = await this.prisma.$runCommandRaw({
              update: BACKGROUND_TASKS_COLLECTION,
              updates: [
                {
                  q: {
                    _id: { $oid: task.id },
                    status: BACKGROUND_TASK_STATUSES.QUEUED,
                  },
                  u: {
                    $set: {
                      status: BACKGROUND_TASK_STATUSES.RUNNING,
                      startedAt: { $date: now.toISOString() },
                      leaseOwner: workerId,
                      leaseExpiresAt: {
                        $date: new Date(
                          Date.now() + WORKER_LEASE_MS,
                        ).toISOString(),
                      },
                      updatedAt: { $date: new Date().toISOString() },
                    },
                    $inc: { eventSequence: 1 },
                  },
                  multi: false,
                },
              ],
            });
            return Number((result as { n?: number }).n ?? 0) === 1;
          },
        );
        if (claimed) return this.findById(task.id);
      } catch {
        /* race */
      }
    }
    const expired = await this.prisma.backgroundTask.findMany({
      where: {
        status: BACKGROUND_TASK_STATUSES.RUNNING,
        leaseExpiresAt: { lt: now },
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });
    for (const task of expired) {
      if (task.type === BACKGROUND_TASK_TYPES.RESUME_GENERATION) {
        try {
          await this.complete(
            task.id,
            {},
            BACKGROUND_TASK_STATUSES.FAILED,
            'Worker lease expired',
          );
        } catch {
          /* race */
        }
        continue;
      }
      try {
        const claimed = await withReplicaSetFallback(
          async () => {
            const updated = await this.prisma.backgroundTask.updateMany({
              where: {
                id: task.id,
                status: BACKGROUND_TASK_STATUSES.RUNNING,
                leaseExpiresAt: { lt: now },
              },
              data: {
                leaseOwner: workerId,
                startedAt: now,
                leaseExpiresAt: new Date(Date.now() + WORKER_LEASE_MS),
                eventSequence: { increment: 1 },
              },
            });
            return updated.count === 1;
          },
          async () => {
            const result = await this.prisma.$runCommandRaw({
              update: BACKGROUND_TASKS_COLLECTION,
              updates: [
                {
                  q: {
                    _id: { $oid: task.id },
                    status: BACKGROUND_TASK_STATUSES.RUNNING,
                    leaseExpiresAt: { $lt: { $date: now.toISOString() } },
                  },
                  u: {
                    $set: {
                      leaseOwner: workerId,
                      startedAt: { $date: now.toISOString() },
                      leaseExpiresAt: {
                        $date: new Date(
                          Date.now() + WORKER_LEASE_MS,
                        ).toISOString(),
                      },
                      updatedAt: { $date: new Date().toISOString() },
                    },
                    $inc: { eventSequence: 1 },
                  },
                  multi: false,
                },
              ],
            });
            return Number((result as { n?: number }).n ?? 0) === 1;
          },
        );
        if (claimed) return this.findById(task.id);
      } catch {
        /* race */
      }
    }
    return null;
  }

  async heartbeat(id: string, workerId: string) {
    await withReplicaSetFallback(
      () =>
        this.prisma.backgroundTask.updateMany({
          where: { id, leaseOwner: workerId },
          data: {
            leaseExpiresAt: new Date(Date.now() + WORKER_LEASE_MS),
          },
        }),
      async () => {
        await this.prisma.$runCommandRaw({
          update: BACKGROUND_TASKS_COLLECTION,
          updates: [
            {
              q: { _id: { $oid: id }, leaseOwner: workerId },
              u: {
                $set: {
                  leaseExpiresAt: {
                    $date: new Date(Date.now() + WORKER_LEASE_MS).toISOString(),
                  },
                  updatedAt: { $date: new Date().toISOString() },
                },
              },
              multi: false,
            },
          ],
        });
        return { count: 1 };
      },
    );
  }

  async listSince(profileId: string, since: Date) {
    return this.prisma.backgroundTask.findMany({
      where: {
        profileId,
        updatedAt: { gt: since },
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
    });
  }

  private async rawPatch(id: string, set: Record<string, unknown>) {
    await this.prisma.$runCommandRaw({
      update: BACKGROUND_TASKS_COLLECTION,
      updates: [
        {
          q: { _id: { $oid: id } },
          u: {
            $set: {
              ...Object.fromEntries(
                Object.entries(set).map(([k, v]) => [
                  k,
                  v instanceof Date ? { $date: v.toISOString() } : v,
                ]),
              ),
              updatedAt: { $date: new Date().toISOString() },
            },
            $inc: { eventSequence: 1 },
          },
          multi: false,
        },
      ],
    });
  }
}
