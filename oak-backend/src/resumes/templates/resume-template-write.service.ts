import { Injectable } from '@nestjs/common';
import type { Prisma, ResumeTemplate } from '@prisma/client';
import {
  deleteManyWithFallback,
  rawInsertOne,
  withReplicaSetFallback,
} from '../../prisma/mongo-standalone';
import { PrismaService } from '../../prisma/prisma.service';

const COLLECTION = 'resume_templates';

export type ResumeTemplateCreateData = {
  profileId: string;
  ownerName: string;
  name: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  contentSha256: string;
  slotCount: number;
  sectionsFound: string[];
  slots: Prisma.InputJsonValue;
  warnings: string[];
};

@Injectable()
export class ResumeTemplateWriteService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: ResumeTemplateCreateData): Promise<ResumeTemplate> {
    const now = new Date();
    return withReplicaSetFallback(
      () =>
        this.prisma.resumeTemplate.create({
          data: {
            profileId: data.profileId,
            ownerName: data.ownerName,
            name: data.name,
            fileName: data.fileName,
            mimeType: data.mimeType,
            sizeBytes: data.sizeBytes,
            storagePath: data.storagePath,
            contentSha256: data.contentSha256,
            slotCount: data.slotCount,
            sectionsFound: data.sectionsFound,
            slots: data.slots,
            warnings: data.warnings,
          },
        }),
      async () => {
        await rawInsertOne(this.prisma, COLLECTION, {
          profileId: { $oid: data.profileId },
          ownerName: data.ownerName,
          name: data.name,
          fileName: data.fileName,
          mimeType: data.mimeType,
          sizeBytes: data.sizeBytes,
          storagePath: data.storagePath,
          contentSha256: data.contentSha256,
          slotCount: data.slotCount,
          sectionsFound: data.sectionsFound,
          slots: data.slots,
          warnings: data.warnings,
          uploadedAt: now,
          updatedAt: now,
        });
        const created = await this.prisma.resumeTemplate.findFirst({
          where: {
            profileId: data.profileId,
            contentSha256: data.contentSha256,
            fileName: data.fileName,
          },
          orderBy: { uploadedAt: 'desc' },
        });
        if (!created) {
          throw new Error('Failed to load resume template after raw insert');
        }
        return created;
      },
    );
  }

  async delete(id: string): Promise<void> {
    await deleteManyWithFallback(
      this.prisma,
      COLLECTION,
      { _id: { $oid: id } },
      () => this.prisma.resumeTemplate.deleteMany({ where: { id } }),
    );
  }
}
