import { Injectable } from '@nestjs/common';
import type { Prisma, UploadSession } from '@prisma/client';
import { rawInsertOne, rawUpdateMany } from '../../prisma/mongo-standalone';
import { PrismaService } from '../../prisma/prisma.service';
import { UPLOAD_SESSION_TTL_MS } from '../constants/bid-status.constants';

/** Must match `@@map("upload_sessions")` on UploadSession. */
const UPLOAD_SESSIONS_COLLECTION = 'upload_sessions';

/**
 * Resumable upload handshake rows.
 * Always uses $runCommandRaw writes — Prisma Mongo create/update need a
 * replica set, and local AthensDB is often standalone.
 */
@Injectable()
export class UploadSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    uploadId: string;
    uid?: string | null;
    applierName: string;
    jobId: string;
    sessionId: string;
    storagePath: string;
    contentType: string;
    expectedBytes: number;
    expectedSha256?: string | null;
  }): Promise<UploadSession> {
    const now = new Date();
    const expiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_MS);
    await rawInsertOne(this.prisma, UPLOAD_SESSIONS_COLLECTION, {
      _id: input.uploadId,
      uid: input.uid ?? null,
      applierName: input.applierName,
      jobId: input.jobId,
      sessionId: input.sessionId,
      storagePath: input.storagePath,
      contentType: input.contentType,
      expectedBytes: input.expectedBytes,
      expectedSha256: input.expectedSha256 ?? null,
      status: 'pending',
      expiresAt,
      actualBytes: null,
      actualSha256: null,
      generation: null,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.findById(input.uploadId);
    if (!created) throw new Error('Failed to load created upload session');
    return created;
  }

  async findById(uploadId: string): Promise<UploadSession | null> {
    return this.prisma.uploadSession.findUnique({
      where: { id: String(uploadId) },
    });
  }

  async markCompleted(
    uploadId: string,
    data: {
      actualBytes: number;
      actualSha256?: string | null;
      generation?: string | null;
      contentType?: string;
    },
  ): Promise<UploadSession> {
    return this.patch(uploadId, {
      status: 'completed',
      actualBytes: data.actualBytes,
      actualSha256: data.actualSha256 ?? null,
      generation: data.generation ?? null,
      ...(data.contentType ? { contentType: data.contentType } : {}),
      updatedAt: new Date(),
    });
  }

  async markRejected(
    uploadId: string,
    data: { actualBytes?: number; actualSha256?: string | null },
  ): Promise<UploadSession> {
    return this.patch(uploadId, {
      status: 'rejected',
      actualBytes: data.actualBytes ?? null,
      actualSha256: data.actualSha256 ?? null,
      updatedAt: new Date(),
    });
  }

  private async patch(
    uploadId: string,
    set: Prisma.InputJsonValue,
  ): Promise<UploadSession> {
    await rawUpdateMany(
      this.prisma,
      UPLOAD_SESSIONS_COLLECTION,
      { _id: uploadId },
      set,
    );
    const updated = await this.findById(uploadId);
    if (!updated) throw new Error('Failed to load updated upload session');
    return updated;
  }
}
