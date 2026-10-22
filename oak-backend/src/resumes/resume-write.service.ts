import { Injectable } from '@nestjs/common';
import type { Prisma, Resume } from '@prisma/client';
import {
  deleteManyWithFallback,
  rawInsertOne,
  rawUpdateMany,
  withReplicaSetFallback,
} from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';

/** Must match `@@map("resumes")` on Resume in schema.prisma. */
const RESUMES_COLLECTION = 'resumes';

export type ResumeCreateData = {
  profileId: string;
  ownerName: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  contentSha256: string;
  extractedText?: string | null;
  isPrimary?: boolean;
  source?: string;
  generationId?: string | null;
  templateId?: string | null;
  parentJobId?: string | null;
  analysis?: Prisma.InputJsonValue | null;
};

@Injectable()
export class ResumeWriteService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: ResumeCreateData): Promise<Resume> {
    const now = new Date();
    const source = data.source || 'uploaded';
    const isPrimary = Boolean(data.isPrimary);

    return withReplicaSetFallback(
      () =>
        this.prisma.resume.create({
          data: {
            profileId: data.profileId,
            ownerName: data.ownerName,
            title: data.title,
            fileName: data.fileName,
            mimeType: data.mimeType,
            sizeBytes: data.sizeBytes,
            storagePath: data.storagePath,
            contentSha256: data.contentSha256,
            extractedText: data.extractedText ?? null,
            isPrimary,
            source,
            generationId: data.generationId ?? null,
            templateId: data.templateId ?? null,
            parentJobId: data.parentJobId ?? null,
            analysis: data.analysis ?? null,
          },
        }),
      async () => {
        await rawInsertOne(this.prisma, RESUMES_COLLECTION, {
          profileId: { $oid: data.profileId },
          ownerName: data.ownerName,
          title: data.title,
          fileName: data.fileName,
          mimeType: data.mimeType,
          sizeBytes: data.sizeBytes,
          storagePath: data.storagePath,
          contentSha256: data.contentSha256,
          extractedText: data.extractedText ?? null,
          isPrimary,
          source,
          generationId: data.generationId ?? null,
          templateId: data.templateId ?? null,
          parentJobId: data.parentJobId ?? null,
          analyzed: false,
          analyzedAt: null,
          analysis: data.analysis ?? null,
          analysisError: null,
          uploadedAt: now,
          updatedAt: now,
        });
        const created = await this.prisma.resume.findFirst({
          where: {
            profileId: data.profileId,
            contentSha256: data.contentSha256,
            fileName: data.fileName,
          },
          orderBy: { uploadedAt: 'desc' },
        });
        if (!created) {
          throw new Error('Failed to load resumes after raw insert');
        }
        return created;
      },
    );
  }

  async update(id: string, data: Prisma.ResumeUpdateInput): Promise<Resume> {
    return withReplicaSetFallback(
      () => this.prisma.resume.update({ where: { id }, data }),
      async () => {
        const set = prismaUpdateToSet(data);
        set.updatedAt = new Date();
        await rawUpdateMany(
          this.prisma,
          RESUMES_COLLECTION,
          { _id: { $oid: id } },
          set as Prisma.InputJsonValue,
        );
        const updated = await this.prisma.resume.findUnique({ where: { id } });
        if (!updated) {
          throw new Error('Failed to load resumes after raw update');
        }
        return updated;
      },
    );
  }

  async updateMany(
    where: { profileId: string },
    data: { isPrimary: boolean },
  ): Promise<number> {
    return withReplicaSetFallback(
      async () => {
        const result = await this.prisma.resume.updateMany({ where, data });
        return result.count;
      },
      () =>
        rawUpdateMany(
          this.prisma,
          RESUMES_COLLECTION,
          { profileId: { $oid: where.profileId } },
          { ...data, updatedAt: new Date() },
        ),
    );
  }

  async delete(id: string): Promise<void> {
    await deleteManyWithFallback(
      this.prisma,
      RESUMES_COLLECTION,
      { _id: { $oid: id } },
      () => this.prisma.resume.deleteMany({ where: { id } }),
    );
  }
}

function prismaUpdateToSet(
  data: Prisma.ResumeUpdateInput,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    // Scalar/Json writes come through as plain values (not { set: ... }).
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      'set' in (value as object)
    ) {
      out[key] = (value as { set: unknown }).set;
      continue;
    }
    out[key] = value;
  }
  return out;
}
