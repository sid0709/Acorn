import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Resume } from '@prisma/client';
import { AccountInfoService } from '../../auth/account-info.service';
import {
  AGENT_JOB_RESUME_FOLDER,
  RESUME_DOCX_MIME,
} from '../constants/agent-job-resume.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { resumeParentJobId } from '../lib/parent-job-id';
import { ResumeStorageService } from '../resume-storage.service';
import { ResumeWriteService } from '../resume-write.service';
import { cleanString } from './lib/clean-string';
import { resumeDownloadFileName } from './lib/resume-file-name';
import { sectionsToText } from './lib/sections-to-text';
import { ResumeJobDocxService } from './resume-job-docx.service';

export type JobLinkedArtifactInput = {
  generationId: string;
  ownerName: string;
  profileId: string;
  parentJobId: string;
  sections: Record<string, unknown>;
  identity: Record<string, unknown> | null;
  templateId: string | null;
  config?: Record<string, unknown> | null;
};

/** One Mongo library row + one stable Storage DOCX per applier × job. */
@Injectable()
export class ResumeJobArtifactService {
  private readonly logger = new Logger(ResumeJobArtifactService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountInfoService,
    private readonly storage: ResumeStorageService,
    private readonly writes: ResumeWriteService,
    private readonly docx: ResumeJobDocxService,
  ) {}

  async upsertFromGeneration(
    input: JobLinkedArtifactInput,
  ): Promise<Resume | null> {
    const account = (await this.accounts.findByName(input.ownerName)) || null;
    const profileId = account?.id || input.profileId;
    if (!profileId || !input.ownerName) return null;

    const extractedText = sectionsToText(input.sections, input.identity);
    const fileName = resumeDownloadFileName(
      cleanString(input.identity?.fullName) || input.ownerName,
    );
    const stored = await this.renderAndStoreDocx(input, profileId, fileName);
    return this.persistRow(input, profileId, extractedText, fileName, stored);
  }

  /** Retry DOCX render for a job-linked row that already has generation text. */
  async ensureDocx(row: Resume): Promise<Resume> {
    const parentJobId = resumeParentJobId(row);
    const generationId = String(row.generationId || '').trim();
    if (!parentJobId || !generationId) return row;

    const run = await this.prisma.resumeGeneration.findFirst({
      where: { id: generationId, applierName: row.ownerName },
    });
    if (!run) return row;

    const sections =
      run.sections && typeof run.sections === 'object'
        ? (run.sections as Record<string, unknown>)
        : {};
    const identity =
      run.identity && typeof run.identity === 'object'
        ? (run.identity as Record<string, unknown>)
        : null;
    const config =
      run.config && typeof run.config === 'object'
        ? (run.config as Record<string, unknown>)
        : null;
    const fileName = resumeDownloadFileName(
      String(row.fileName || '').replace(/\.pdf$/i, '') || row.ownerName,
    );
    const stored = await this.renderAndStoreDocx(
      {
        generationId,
        ownerName: row.ownerName,
        profileId: row.profileId,
        parentJobId,
        sections,
        identity,
        templateId: row.templateId,
        config,
      },
      row.profileId,
      fileName,
    );
    if (!stored) return row;
    const previousPath = String(row.storagePath || '').trim();
    const updated = await this.writes.update(row.id, {
      fileName,
      mimeType: RESUME_DOCX_MIME,
      sizeBytes: stored.sizeBytes,
      storagePath: stored.storagePath,
      contentSha256: stored.contentSha256,
      parentJobId,
    });
    if (previousPath && previousPath !== stored.storagePath) {
      await this.storage.delete(previousPath).catch(() => undefined);
    }
    return updated;
  }

  private async renderAndStoreDocx(
    input: JobLinkedArtifactInput,
    profileId: string,
    fileName: string,
  ) {
    try {
      const buffer = await this.docx.render({
        ownerName: input.ownerName,
        templateId: input.templateId,
        sections: input.sections,
        identity: input.identity,
        config: input.config,
      });
      return this.storage.put({
        ownerName: input.ownerName,
        profileId,
        fileName,
        mimeType: RESUME_DOCX_MIME,
        buffer,
        folder: AGENT_JOB_RESUME_FOLDER,
        objectKey: `${input.parentJobId}.docx`,
      });
    } catch (err) {
      this.logger.warn(
        `job résumé DOCX failed job=${input.parentJobId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private async persistRow(
    input: JobLinkedArtifactInput,
    profileId: string,
    extractedText: string,
    fileName: string,
    stored: {
      storagePath: string;
      contentSha256: string;
      sizeBytes: number;
    } | null,
  ): Promise<Resume> {
    const analysis = {
      generateParentJobId: input.parentJobId,
    } as Prisma.InputJsonValue;
    const existing = await this.findExisting(
      input.ownerName,
      input.parentJobId,
    );
    const binary = {
      fileName,
      mimeType: RESUME_DOCX_MIME,
      ...(stored
        ? {
            sizeBytes: stored.sizeBytes,
            storagePath: stored.storagePath,
            contentSha256: stored.contentSha256,
          }
        : {}),
    };

    if (existing) {
      const previousPath = String(existing.storagePath || '').trim();
      const updated = await this.writes.update(existing.id, {
        title: 'Generated',
        extractedText,
        templateId: input.templateId,
        generationId: input.generationId,
        parentJobId: input.parentJobId,
        analysis,
        ...binary,
      });
      if (stored && previousPath && previousPath !== stored.storagePath) {
        await this.storage.delete(previousPath).catch(() => undefined);
      }
      return updated;
    }

    return this.writes.create({
      profileId,
      ownerName: input.ownerName,
      title: 'Generated',
      fileName,
      mimeType: RESUME_DOCX_MIME,
      sizeBytes: stored?.sizeBytes ?? 0,
      storagePath: stored?.storagePath ?? '',
      contentSha256: stored?.contentSha256 ?? `pending:${input.parentJobId}`,
      extractedText,
      isPrimary: false,
      source: 'generated',
      generationId: input.generationId,
      templateId: input.templateId,
      parentJobId: input.parentJobId,
      analysis,
    });
  }

  private async findExisting(ownerName: string, parentJobId: string) {
    const byField = await this.prisma.resume.findFirst({
      where: { ownerName, parentJobId },
    });
    if (byField) return byField;
    const legacy = await this.prisma.resume.findMany({
      where: { ownerName, source: 'generated', parentJobId: null },
      take: 500,
    });
    return legacy.find((row) => resumeParentJobId(row) === parentJobId) || null;
  }
}
