import { BadRequestException, Injectable } from '@nestjs/common';
import type { AccountInfo } from '@prisma/client';
import { mapPool } from '../ai/concurrency/create-limiter';
import { AccountInfoService } from '../auth/account-info.service';
import { OBJECT_ID_PATTERN } from '../personal/constants/profile-field.constants';
import { asText } from '../personal/mappers/as-text';
import { PrismaService } from '../prisma/prisma.service';
import {
  RESUME_ALLOWED_MIME,
  RESUME_MIME_HINT,
} from './constants/resume-mime.constants';
import { RESUME_BULK_UPLOAD_CONCURRENCY } from './constants/resume-upload.constants';
import {
  toResumeSummary,
  type UserResumeSummary,
} from './mappers/resume.mapper';
import { ResumeStorageService } from './resume-storage.service';
import { ResumeTextService } from './resume-text.service';
import { ResumeWriteService } from './resume-write.service';

@Injectable()
export class ResumeUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountInfoService,
    private readonly storage: ResumeStorageService,
    private readonly text: ResumeTextService,
    private readonly writes: ResumeWriteService,
  ) {}

  async create(input: {
    ownerName: string;
    ownerId: string;
    techStack: string;
    fileName: string;
    mimeType: string;
    contentBase64: string;
  }): Promise<UserResumeSummary> {
    const ownerName = asText(input.ownerName).trim();
    const title = asText(input.techStack).trim();
    const fileName = asText(input.fileName).trim();
    const mimeType =
      asText(input.mimeType).trim() || 'application/octet-stream';
    const contentBase64 = String(input.contentBase64 || '');
    const ownerId = asText(input.ownerId).trim();

    if (!ownerName) throw bad('ownerName is required');
    if (!title) throw bad('techStack is required');
    if (!fileName) throw bad('fileName is required');
    if (!contentBase64) throw bad('contentBase64 is required');
    if (!OBJECT_ID_PATTERN.test(ownerId))
      throw bad('Valid ownerId is required');

    const acc = await this.resolveOwner(ownerName, ownerId);
    return this.createForAccount(acc, {
      techStack: title,
      fileName,
      mimeType,
      contentBase64,
    });
  }

  async bulkCreate(input: {
    ownerName: string;
    ownerId: string;
    items: Array<{
      ownerName?: string;
      ownerId?: string;
      techStack: string;
      fileName: string;
      mimeType: string;
      contentBase64: string;
    }>;
  }): Promise<{
    ok: UserResumeSummary[];
    failed: { fileName: string; error: string }[];
  }> {
    const ownerName = asText(input.ownerName).trim();
    const ownerId = asText(input.ownerId).trim();
    if (!ownerName) throw bad('ownerName is required');
    if (!OBJECT_ID_PATTERN.test(ownerId))
      throw bad('Valid ownerId is required');

    const acc = await this.resolveOwner(ownerName, ownerId);
    const items = input.items || [];
    const ok: UserResumeSummary[] = [];
    const failed: { fileName: string; error: string }[] = [];

    const outcomes = await mapPool(
      items,
      RESUME_BULK_UPLOAD_CONCURRENCY,
      async (item) => {
        try {
          const summary = await this.createForAccount(
            acc,
            {
              techStack: asText(item.techStack).trim(),
              fileName: asText(item.fileName).trim(),
              mimeType:
                asText(item.mimeType).trim() || 'application/octet-stream',
              contentBase64: String(item.contentBase64 || ''),
            },
            { ensurePrimary: false },
          );
          return { ok: summary, failed: null };
        } catch (err) {
          return {
            ok: null,
            failed: {
              fileName: item?.fileName || 'unknown',
              error: err instanceof Error ? err.message : String(err),
            },
          };
        }
      },
    );

    for (const outcome of outcomes) {
      if (outcome.ok) ok.push(outcome.ok);
      if (outcome.failed) failed.push(outcome.failed);
    }

    await this.ensureOnePrimary(acc.id);
    return { ok, failed };
  }

  private async createForAccount(
    acc: AccountInfo,
    input: {
      techStack: string;
      fileName: string;
      mimeType: string;
      contentBase64: string;
    },
    opts?: { ensurePrimary?: boolean },
  ): Promise<UserResumeSummary> {
    const title = asText(input.techStack).trim();
    const fileName = asText(input.fileName).trim();
    const mimeType =
      asText(input.mimeType).trim() || 'application/octet-stream';
    const contentBase64 = String(input.contentBase64 || '');

    if (!title) throw bad('techStack is required');
    if (!fileName) throw bad('fileName is required');
    if (!contentBase64) throw bad('contentBase64 is required');

    const buffer = Buffer.from(contentBase64, 'base64');
    if (!buffer.length) throw bad('Empty file content');

    if (
      !RESUME_ALLOWED_MIME.has(mimeType) &&
      !/\.(pdf|docx?|txt)$/i.test(fileName)
    ) {
      throw bad(RESUME_MIME_HINT);
    }

    const extractedText = await this.text.extract(buffer, mimeType, fileName);
    const stored = await this.storage.put({
      ownerName: acc.name,
      profileId: acc.id,
      fileName,
      mimeType,
      buffer,
    });

    const row = await this.writes.create({
      profileId: acc.id,
      ownerName: acc.name,
      title,
      fileName,
      mimeType,
      sizeBytes: stored.sizeBytes,
      storagePath: stored.storagePath,
      contentSha256: stored.contentSha256,
      extractedText,
      isPrimary: false,
      source: 'uploaded',
    });

    if (opts?.ensurePrimary !== false) {
      await this.ensureOnePrimary(acc.id);
      const fresh = await this.prisma.resume.findUnique({
        where: { id: row.id },
      });
      return toResumeSummary(fresh ?? row);
    }
    return toResumeSummary(row);
  }

  /** Ensure at least one primary exists (idempotent under parallel uploads). */
  private async ensureOnePrimary(profileId: string): Promise<void> {
    const existing = await this.prisma.resume.findFirst({
      where: { profileId, isPrimary: true },
      select: { id: true },
    });
    if (existing) return;
    const next = await this.prisma.resume.findFirst({
      where: { profileId },
      orderBy: { uploadedAt: 'asc' },
      select: { id: true },
    });
    if (next) await this.writes.update(next.id, { isPrimary: true });
  }

  private async resolveOwner(ownerName: string, ownerId: string) {
    const byId = await this.prisma.accountInfo.findUnique({
      where: { id: ownerId },
    });
    if (byId) return byId;
    const byName = await this.accounts.findByName(ownerName);
    if (!byName) throw bad('Account not found');
    return byName;
  }
}

function bad(message: string): BadRequestException {
  return new BadRequestException({ success: false, message, error: message });
}
