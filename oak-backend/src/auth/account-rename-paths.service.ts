import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  isReplicaSetRequired,
  rawUpdateMany,
} from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';
import {
  rewriteJsonPaths,
  rewriteStringPath,
} from './lib/rewrite-storage-prefix';

const RESUMES = 'resumes';
const RESUME_TEMPLATES = 'resume_templates';
const UPLOAD_SESSIONS = 'upload_sessions';

/** Rewrites stored blob paths after a username storage copy. */
@Injectable()
export class AccountRenamePathsService {
  constructor(private readonly prisma: PrismaService) {}

  async rewriteStoragePrefix(
    oldPrefix: string,
    newPrefix: string,
  ): Promise<void> {
    if (!oldPrefix || oldPrefix === newPrefix) return;
    await this.rewriteResumePaths(oldPrefix, newPrefix);
    await this.rewriteTemplatePaths(oldPrefix, newPrefix);
    await this.rewriteUploadPaths(oldPrefix, newPrefix);
  }

  async rewriteVendorRecordingPrefix(
    applierName: string,
    oldPrefix: string,
    newPrefix: string,
  ): Promise<void> {
    if (!oldPrefix || oldPrefix === newPrefix) return;
    const rows = await this.prisma.vendorTask.findMany({
      where: { applierName },
      select: { id: true, recordings: true, recordingPath: true },
    });
    for (const row of rows) {
      const recordings = rewriteJsonPaths(row.recordings, oldPrefix, newPrefix);
      const recordingPath = rewriteStringPath(
        row.recordingPath,
        oldPrefix,
        newPrefix,
      );
      if (
        recordings === row.recordings &&
        recordingPath === row.recordingPath
      ) {
        continue;
      }
      await this.prisma.vendorTask.update({
        where: { id: row.id },
        data: {
          ...(recordings !== row.recordings
            ? { recordings: recordings as Prisma.InputJsonValue }
            : {}),
          ...(recordingPath !== row.recordingPath ? { recordingPath } : {}),
        },
      });
    }
  }

  private async rewriteResumePaths(
    oldPrefix: string,
    newPrefix: string,
  ): Promise<void> {
    const rows = await this.prisma.resume.findMany({
      where: { storagePath: { startsWith: oldPrefix } },
      select: { id: true, storagePath: true },
    });
    for (const row of rows) {
      const next = rewriteStringPath(row.storagePath, oldPrefix, newPrefix);
      if (!next || next === row.storagePath) continue;
      await this.run(RESUMES, { _id: row.id }, { storagePath: next }, () =>
        this.prisma.resume.update({
          where: { id: row.id },
          data: { storagePath: next },
        }),
      );
    }
  }

  private async rewriteTemplatePaths(
    oldPrefix: string,
    newPrefix: string,
  ): Promise<void> {
    const rows = await this.prisma.resumeTemplate.findMany({
      where: { storagePath: { startsWith: oldPrefix } },
      select: { id: true, storagePath: true },
    });
    for (const row of rows) {
      const next = rewriteStringPath(row.storagePath, oldPrefix, newPrefix);
      if (!next || next === row.storagePath) continue;
      await this.run(
        RESUME_TEMPLATES,
        { _id: row.id },
        { storagePath: next },
        () =>
          this.prisma.resumeTemplate.update({
            where: { id: row.id },
            data: { storagePath: next },
          }),
      );
    }
  }

  private async rewriteUploadPaths(
    oldPrefix: string,
    newPrefix: string,
  ): Promise<void> {
    const rows = await this.prisma.uploadSession.findMany({
      where: { storagePath: { startsWith: oldPrefix } },
      select: { id: true, storagePath: true },
    });
    for (const row of rows) {
      const next = rewriteStringPath(row.storagePath, oldPrefix, newPrefix);
      if (!next || next === row.storagePath) continue;
      await this.run(
        UPLOAD_SESSIONS,
        { _id: row.id },
        { storagePath: next },
        () =>
          this.prisma.uploadSession.update({
            where: { id: row.id },
            data: { storagePath: next },
          }),
      );
    }
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
}
