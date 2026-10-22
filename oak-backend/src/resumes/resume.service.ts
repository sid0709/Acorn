import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Resume } from '@prisma/client';
import { AccountInfoService } from '../auth/account-info.service';
import { OBJECT_ID_PATTERN } from '../personal/constants/profile-field.constants';
import { asText } from '../personal/mappers/as-text';
import { PrismaService } from '../prisma/prisma.service';
import {
  toResumeDetail,
  toResumeSummary,
  type UserResumeDetail,
  type UserResumeSummary,
} from './mappers/resume.mapper';
import { ResumeStorageService } from './resume-storage.service';
import { ResumeUploadService } from './resume-upload.service';
import { ResumeWriteService } from './resume-write.service';

@Injectable()
export class ResumeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountInfoService,
    private readonly storage: ResumeStorageService,
    private readonly upload: ResumeUploadService,
    private readonly writes: ResumeWriteService,
  ) {}

  create(input: Parameters<ResumeUploadService['create']>[0]) {
    return this.upload.create(input);
  }

  bulkCreate(input: Parameters<ResumeUploadService['bulkCreate']>[0]) {
    return this.upload.bulkCreate(input);
  }

  async list(
    ownerName: string,
    options?: { source?: string; profileId?: string },
  ): Promise<UserResumeSummary[]> {
    const acc = await this.resolveAccount(ownerName, options?.profileId);
    const source = asText(options?.source).trim();

    const rows = await this.prisma.resume.findMany({
      where:
        source === 'generated'
          ? { profileId: acc.id, source: 'generated' }
          : source === 'uploaded'
            ? { profileId: acc.id, source: 'uploaded' }
            : { profileId: acc.id },
      orderBy: [{ isPrimary: 'desc' }, { uploadedAt: 'desc' }],
    });
    return rows.map(toResumeSummary);
  }

  async get(id: string, ownerName: string): Promise<UserResumeDetail> {
    const row = await this.findOwned(id, ownerName);
    const buffer = await this.storage.download(row.storagePath);
    return toResumeDetail(row, buffer ? buffer.toString('base64') : null);
  }

  async setPrimary(id: string, ownerName: string): Promise<UserResumeSummary> {
    const row = await this.findOwned(id, ownerName);
    await this.writes.updateMany(
      { profileId: row.profileId },
      { isPrimary: false },
    );
    const updated = await this.writes.update(row.id, { isPrimary: true });
    return toResumeSummary(updated);
  }

  async delete(id: string, ownerName: string) {
    const row = await this.findOwned(id, ownerName);
    const storagePath = String(row.storagePath || '').trim();

    // Content is addressed by sha256 — only remove the blob when this is the
    // last library row pointing at that Storage path.
    const sharedRefs = storagePath
      ? await this.prisma.resume.count({
          where: { storagePath, id: { not: row.id } },
        })
      : 0;

    // Drop Mongo first so analysis / metadata cannot outlive a successful delete.
    await this.writes.delete(row.id);

    if (storagePath && sharedRefs === 0) {
      await this.storage.delete(storagePath);
    }

    if (row.isPrimary) {
      const next = await this.prisma.resume.findFirst({
        where: { profileId: row.profileId },
        orderBy: { uploadedAt: 'desc' },
      });
      if (next) {
        await this.writes.update(next.id, { isPrimary: true });
      }
    }

    return { success: true as const, deleted: true, id: row.id };
  }

  async clearAnalysis(
    id: string,
    ownerName: string,
  ): Promise<UserResumeSummary> {
    await this.findOwned(id, ownerName);
    const updated = await this.writes.update(id, {
      analyzed: false,
      analyzedAt: null,
      analysis: { skills: [] },
      analysisError: null,
    });
    return toResumeSummary(updated);
  }

  async resolveAccount(ownerName: string, profileId?: string) {
    const id = asText(profileId).trim();
    if (id && OBJECT_ID_PATTERN.test(id)) {
      const byId = await this.prisma.accountInfo.findUnique({ where: { id } });
      if (byId) return byId;
    }
    const name = asText(ownerName).trim();
    if (!name) throw bad('ownerName is required');
    const acc = await this.accounts.findByName(name);
    if (!acc) {
      throw new NotFoundException({
        success: false,
        message: 'Account not found',
        error: 'Account not found',
      });
    }
    return acc;
  }

  async findOwned(id: string, ownerName: string): Promise<Resume> {
    const name = asText(ownerName).trim();
    if (!name) throw bad('ownerName is required');
    if (!OBJECT_ID_PATTERN.test(id)) throw bad('Invalid resume id');
    const row = await this.prisma.resume.findFirst({
      where: { id, ownerName: name },
    });
    if (!row) {
      throw new NotFoundException({
        success: false,
        message: 'Resume not found',
        error: 'Resume not found',
      });
    }
    return row;
  }
}

function bad(message: string): BadRequestException {
  return new BadRequestException({ success: false, message, error: message });
}
