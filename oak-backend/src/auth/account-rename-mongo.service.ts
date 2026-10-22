import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  isReplicaSetRequired,
  rawUpdateMany,
} from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';

const C = {
  vendorTasks: 'vendor_tasks',
  bidReviewEvents: 'bid_review_events',
  athensLensSessions: 'athens_lens_sessions',
  oakSessions: 'oak_sessions',
  uploadSessions: 'upload_sessions',
  resumes: 'resumes',
  resumeTemplates: 'resume_templates',
  resumeGeneratorConfig: 'resume_generator_config',
  resumeGenerations: 'resume_generations',
  backgroundTaskInputs: 'background_task_inputs',
  backgroundTasks: 'background_tasks',
  mailMessages: 'mail_messages',
  mailSyncState: 'mail_sync_state',
  aiApiUsage: 'ai_api_usage',
} as const;

/**
 * Retarget applier-owned rows from the old login name to the new one.
 * Storage paths are rewritten separately after blobs are copied.
 */
@Injectable()
export class AccountRenameMongoService {
  constructor(private readonly prisma: PrismaService) {}

  async retargetApplierName(oldName: string, newName: string): Promise<void> {
    const from = String(oldName || '').trim();
    const to = String(newName || '').trim();
    if (!from || !to || from === to) return;

    await this.run(
      C.vendorTasks,
      { applierName: from },
      { applierName: to },
      () =>
        this.prisma.vendorTask.updateMany({
          where: { applierName: from },
          data: { applierName: to },
        }),
    );
    await this.run(
      C.bidReviewEvents,
      { applierName: from },
      { applierName: to },
      () =>
        this.prisma.bidReviewEvent.updateMany({
          where: { applierName: from },
          data: { applierName: to },
        }),
    );
    await this.run(
      C.uploadSessions,
      { applierName: from },
      { applierName: to },
      () =>
        this.prisma.uploadSession.updateMany({
          where: { applierName: from },
          data: { applierName: to },
        }),
    );
    await this.run(
      C.resumeGeneratorConfig,
      { applierName: from },
      { applierName: to },
      () =>
        this.prisma.resumeGeneratorConfig.updateMany({
          where: { applierName: from },
          data: { applierName: to },
        }),
    );
    await this.run(
      C.resumeGenerations,
      { applierName: from },
      { applierName: to },
      () =>
        this.prisma.resumeGeneration.updateMany({
          where: { applierName: from },
          data: { applierName: to },
        }),
    );
    await this.run(
      C.backgroundTaskInputs,
      { applierName: from },
      { applierName: to },
      () =>
        this.prisma.backgroundTaskInput.updateMany({
          where: { applierName: from },
          data: { applierName: to },
        }),
    );
    await this.run(
      C.backgroundTasks,
      { applierName: from },
      { applierName: to },
      () =>
        this.prisma.backgroundTask.updateMany({
          where: { applierName: from },
          data: { applierName: to },
        }),
    );
    await this.run(
      C.mailMessages,
      { applierName: from },
      { applierName: to },
      () =>
        this.prisma.mailMessage.updateMany({
          where: { applierName: from },
          data: { applierName: to },
        }),
    );
    await this.run(
      C.mailSyncState,
      { applierName: from },
      { applierName: to },
      () =>
        this.prisma.mailSyncState.updateMany({
          where: { applierName: from },
          data: { applierName: to },
        }),
    );
    await this.run(
      C.aiApiUsage,
      { applierName: from },
      { applierName: to },
      () =>
        this.prisma.aiApiUsage.updateMany({
          where: { applierName: from },
          data: { applierName: to },
        }),
    );
    await this.run(C.resumes, { ownerName: from }, { ownerName: to }, () =>
      this.prisma.resume.updateMany({
        where: { ownerName: from },
        data: { ownerName: to },
      }),
    );
    await this.run(
      C.resumeTemplates,
      { ownerName: from },
      { ownerName: to },
      () =>
        this.prisma.resumeTemplate.updateMany({
          where: { ownerName: from },
          data: { ownerName: to },
        }),
    );
    await this.renameSessions(C.athensLensSessions, from, to, () =>
      this.prisma.athensLensSession.updateMany({
        where: { OR: [{ applierName: from }, { username: from }] },
        data: { applierName: to, username: to },
      }),
    );
    await this.renameSessions(C.oakSessions, from, to, () =>
      this.prisma.oakSession.updateMany({
        where: { OR: [{ applierName: from }, { username: from }] },
        data: { applierName: to, username: to },
      }),
    );
  }

  private async run(
    collection: string,
    query: Prisma.InputJsonValue,
    set: Prisma.InputJsonValue,
    viaPrisma: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await viaPrisma();
    } catch (error) {
      if (!isReplicaSetRequired(error)) throw error;
      await rawUpdateMany(this.prisma, collection, query, set);
    }
  }

  private async renameSessions(
    collection: string,
    from: string,
    to: string,
    viaPrisma: () => Promise<unknown>,
  ): Promise<void> {
    await this.run(
      collection,
      { $or: [{ applierName: from }, { username: from }] },
      { applierName: to, username: to },
      viaPrisma,
    );
  }
}
