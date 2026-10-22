import { Injectable, NotFoundException } from '@nestjs/common';
import type { Resume } from '@prisma/client';
import { AccountInfoService } from '../../auth/account-info.service';
import { appLogger } from '../../common/logger/app-logger';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GENERATED_LIBRARY_FOLDER,
  RESUME_DOCX_MIME,
} from '../constants/agent-job-resume.constants';
import { isDocxRow } from '../lib/is-docx-row';
import { ResumeStorageService } from '../resume-storage.service';
import { ResumeWriteService } from '../resume-write.service';
import { cleanString } from './lib/clean-string';
import { resumeDownloadFileName } from './lib/resume-file-name';
import { sectionsToText } from './lib/sections-to-text';
import { ResumeJobDocxService } from './resume-job-docx.service';

export type GenerationLibraryInput = {
  generationId: string;
  ownerName: string;
  profileId: string;
  sections: Record<string, unknown>;
  identity: Record<string, unknown> | null;
  templateId: string | null;
  config?: Record<string, unknown> | null;
};

/**
 * Library DOCX for editor / Oak Custom generate (no parent job).
 * Same renderer as Job Search artifacts: uploaded Word template, else structured export.
 */
@Injectable()
export class ResumeGenerationLibraryService {
  private readonly log = appLogger(ResumeGenerationLibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountInfoService,
    private readonly storage: ResumeStorageService,
    private readonly writes: ResumeWriteService,
    private readonly docx: ResumeJobDocxService,
  ) {}

  async upsertFromGeneration(
    input: GenerationLibraryInput,
  ): Promise<Resume | null> {
    const account = (await this.accounts.findByName(input.ownerName)) || null;
    const profileId = account?.id || input.profileId;
    if (!profileId || !input.ownerName) return null;

    const extractedText = sectionsToText(input.sections, input.identity);
    const fileName = resumeDownloadFileName(
      cleanString(input.identity?.fullName) || input.ownerName,
    );
    const stored = await this.renderAndStore(input, profileId, fileName);
    return this.persistRow(input, profileId, extractedText, fileName, stored);
  }

  async loadDocx(
    applierName: string,
    generationId: string,
  ): Promise<{ buffer: Buffer; fileName: string; resumeId: string }> {
    const name = cleanString(applierName);
    const id = cleanString(generationId);
    if (!name || !id) {
      throw new NotFoundException({
        success: false,
        error: 'Generated résumé not found',
      });
    }

    let row = await this.findByGeneration(name, id);
    let buffer =
      row && isDocxRow(row) ? await this.download(row.storagePath) : null;
    if (!buffer) {
      row = await this.ensureDocx(name, id, row);
      buffer = row ? await this.download(row.storagePath) : null;
    }
    if (!row || !buffer) {
      throw new NotFoundException({
        success: false,
        error: 'Generated résumé Word file is not available yet',
      });
    }
    return {
      buffer,
      fileName: resumeDownloadFileName(
        String(row.fileName || '').replace(/\.pdf$/i, '') || name,
      ),
      resumeId: row.id,
    };
  }

  private async ensureDocx(
    applierName: string,
    generationId: string,
    existing: Resume | null,
  ): Promise<Resume | null> {
    const input = await this.inputFromRun(applierName, generationId);
    if (!input) return existing;
    if (existing) {
      input.templateId = existing.templateId || input.templateId;
    }
    return this.upsertFromGeneration(input);
  }

  private async inputFromRun(
    applierName: string,
    generationId: string,
  ): Promise<GenerationLibraryInput | null> {
    const run = await this.prisma.resumeGeneration.findFirst({
      where: { id: generationId, applierName },
    });
    if (!run?.sections || typeof run.sections !== 'object') return null;
    const config =
      run.config && typeof run.config === 'object'
        ? (run.config as Record<string, unknown>)
        : null;
    const identity =
      run.identity && typeof run.identity === 'object'
        ? (run.identity as Record<string, unknown>)
        : null;
    const account = (await this.accounts.findByName(applierName)) || null;
    return {
      generationId,
      ownerName: applierName,
      profileId: account?.id || '',
      sections: run.sections as Record<string, unknown>,
      identity,
      templateId: cleanString(config?.templateId) || null,
      config,
    };
  }

  private async renderAndStore(
    input: GenerationLibraryInput,
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
        folder: GENERATED_LIBRARY_FOLDER,
        objectKey: `${input.generationId}.docx`,
      });
    } catch (err) {
      this.log.warn(
        {
          generationId: input.generationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'generated library DOCX failed',
      );
      return null;
    }
  }

  private async persistRow(
    input: GenerationLibraryInput,
    profileId: string,
    extractedText: string,
    fileName: string,
    stored: {
      storagePath: string;
      contentSha256: string;
      sizeBytes: number;
    } | null,
  ): Promise<Resume> {
    const existing = await this.findByGeneration(
      input.ownerName,
      input.generationId,
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
      contentSha256: stored?.contentSha256 ?? `pending:${input.generationId}`,
      extractedText,
      isPrimary: false,
      source: 'generated',
      generationId: input.generationId,
      templateId: input.templateId,
    });
  }

  private findByGeneration(ownerName: string, generationId: string) {
    return this.prisma.resume.findFirst({
      where: { generationId, ownerName },
    });
  }

  private async download(storagePath: string): Promise<Buffer | null> {
    const path = String(storagePath || '').trim();
    if (!path) return null;
    const buffer = await this.storage.download(path);
    return buffer?.length ? buffer : null;
  }
}
