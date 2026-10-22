import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ResumeTemplate } from '@prisma/client';
import { AccountInfoService } from '../../auth/account-info.service';
import { OBJECT_ID_PATTERN } from '../../personal/constants/profile-field.constants';
import { asText } from '../../personal/mappers/as-text';
import { PrismaService } from '../../prisma/prisma.service';
import { ResumeStorageService } from '../resume-storage.service';
import {
  DOCX_MIME,
  TEMPLATE_STORAGE_FOLDER,
} from './constants/docx-mime.constants';
import { fillTemplateDocx } from './lib/fill-template-docx';
import { parseTemplateDocx } from './lib/parse-template-docx';
import { renderDocxPreviewImages } from './lib/render-docx-preview-images';
import {
  templateDocumentId,
  toTemplateManifest,
  type ResumeTemplateManifest,
  type ResumeTemplateSlot,
  type TemplateIdentity,
} from './mappers/resume-template.mapper';
import { ResumeTemplateWriteService } from './resume-template-write.service';

@Injectable()
export class ResumeTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountInfoService,
    private readonly storage: ResumeStorageService,
    private readonly writes: ResumeTemplateWriteService,
  ) {}

  async list(ownerName: string): Promise<ResumeTemplateManifest[]> {
    const acc = await this.resolveAccount(ownerName);
    const rows = await this.prisma.resumeTemplate.findMany({
      where: { profileId: acc.id },
      orderBy: { uploadedAt: 'desc' },
    });
    return rows.map(toTemplateManifest);
  }

  async create(input: {
    ownerName: string;
    fileName: string;
    contentBase64: string;
    name?: string;
    identity?: TemplateIdentity;
  }): Promise<ResumeTemplateManifest> {
    const ownerName = asText(input.ownerName).trim();
    const fileName = asText(input.fileName).trim();
    const contentBase64 = String(input.contentBase64 || '');
    if (!ownerName) throw bad('ownerName is required');
    if (!fileName) throw bad('fileName is required');
    if (!contentBase64) throw bad('contentBase64 is required');
    if (!/\.docx$/i.test(fileName)) {
      throw bad('Only .docx templates are supported.');
    }

    const buffer = Buffer.from(contentBase64, 'base64');
    if (!buffer.length) throw bad('Empty file content');

    const parsed = parseTemplateDocx(buffer, input.identity);
    const acc = await this.resolveAccount(ownerName);
    const stored = await this.storage.put({
      ownerName: acc.name,
      profileId: acc.id,
      fileName,
      mimeType: DOCX_MIME,
      buffer,
      folder: TEMPLATE_STORAGE_FOLDER,
    });

    const row = await this.writes.create({
      profileId: acc.id,
      ownerName: acc.name,
      name: asText(input.name).trim() || fileName.replace(/\.docx$/i, ''),
      fileName,
      mimeType: DOCX_MIME,
      sizeBytes: stored.sizeBytes,
      storagePath: stored.storagePath,
      contentSha256: stored.contentSha256,
      slotCount: parsed.slotCount,
      sectionsFound: parsed.sectionsFound,
      slots: parsed.slots,
      warnings: parsed.warnings,
    });
    return toTemplateManifest(row);
  }

  async delete(id: string, ownerName: string) {
    const row = await this.findOwned(id, ownerName);
    const storagePath = String(row.storagePath || '').trim();
    const sharedRefs = storagePath
      ? await this.prisma.resumeTemplate.count({
          where: { storagePath, id: { not: row.id } },
        })
      : 0;
    await this.writes.delete(row.id);
    if (storagePath && sharedRefs === 0) {
      await this.storage.delete(storagePath);
    }
    return { deleted: true, id: row.id };
  }

  async fill(input: {
    templateId: string;
    ownerName: string;
    sections?: Record<string, unknown>;
  }): Promise<{
    buffer: Buffer;
    warnings: string[];
    fileName: string;
    templateName: string;
  }> {
    const row = await this.findOwned(
      templateDocumentId(input.templateId),
      input.ownerName,
    );
    const buffer = await this.storage.download(row.storagePath);
    if (!buffer) throw bad('Template file content missing');
    const result = fillTemplateDocx(
      buffer,
      {
        slots: toTemplateManifest(row).slots as ResumeTemplateSlot[],
        warnings: toTemplateManifest(row).warnings,
      },
      input.sections,
    );
    return {
      buffer: result.buffer,
      warnings: result.warnings,
      fileName: row.fileName,
      templateName: row.name,
    };
  }

  async previewHtml(input: {
    templateId: string;
    ownerName: string;
    sections?: Record<string, unknown>;
  }) {
    const fillResult = await this.fill(input);
    const mammoth = await import('mammoth');
    const htmlResult = await mammoth.convertToHtml({
      buffer: fillResult.buffer,
    });
    return {
      html: htmlResult.value || '',
      warnings: [
        ...(fillResult.warnings || []),
        ...(htmlResult.messages || []).map((m) => m.message).filter(Boolean),
      ],
      templateName: fillResult.templateName,
    };
  }

  async previewImages(input: {
    templateId: string;
    ownerName: string;
    sections?: Record<string, unknown>;
  }) {
    const fillResult = await this.fill(input);
    const pages = await renderDocxPreviewImages(fillResult.buffer);
    return {
      pages,
      warnings: fillResult.warnings || [],
      templateName: fillResult.templateName,
    };
  }

  private async resolveAccount(ownerName: string) {
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

  private async findOwned(
    id: string,
    ownerName: string,
  ): Promise<ResumeTemplate> {
    const name = asText(ownerName).trim();
    if (!name) throw bad('ownerName is required');
    if (!OBJECT_ID_PATTERN.test(id)) throw bad('Invalid template id');
    const row = await this.prisma.resumeTemplate.findFirst({
      where: { id, ownerName: name },
    });
    if (!row) {
      throw new NotFoundException({
        success: false,
        message: 'Template not found',
        error: 'Template not found',
      });
    }
    return row;
  }
}

function bad(message: string): BadRequestException {
  return new BadRequestException({ success: false, message, error: message });
}
