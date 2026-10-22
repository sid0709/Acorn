import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { appLogger } from '../../common/logger/app-logger';
import { ResumeService } from '../../resumes/resume.service';
import { docxBufferToPreviewHtml } from '../../resumes/lib/docx-preview-page';
import { looksLikeDocx } from '../../resumes/lib/looks-like-docx';
import { OAK_RECOMMENDED_RESUME_KEY } from '../constants/oak.constants';

@Injectable()
export class OakCustomLibraryResumeService {
  private readonly log = appLogger(OakCustomLibraryResumeService.name);

  constructor(private readonly resumes: ResumeService) {}

  async exists(applierName: string, resumeId: string): Promise<boolean> {
    try {
      const row = await this.resumes.findOwned(resumeId, applierName);
      return Boolean(String(row.storagePath || '').trim());
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      ) {
        return false;
      }
      throw err;
    }
  }

  async getFile(applierName: string, resumeId: string) {
    const detail = await this.resumes.get(resumeId, applierName);
    if (!detail.contentBase64) {
      throw new NotFoundException({
        success: false,
        error: 'Library resume file is missing from storage',
      });
    }
    const stack = String(detail.techStack || '').trim() || null;
    this.log.info(
      { resumeId: detail.id, stack, source: 'library' },
      'oak custom library resume file',
    );
    return {
      success: true as const,
      resumeId: detail.id,
      stack,
      source: 'library' as const,
      file: {
        key: OAK_RECOMMENDED_RESUME_KEY,
        name: detail.fileName,
        mimeType: detail.mimeType || 'application/octet-stream',
        base64: detail.contentBase64,
      },
    };
  }

  async previewHtml(applierName: string, resumeId: string) {
    const assigned = await this.getFile(applierName, resumeId);
    const buffer = Buffer.from(assigned.file.base64, 'base64');
    if (!looksLikeDocx(assigned.file.mimeType, assigned.file.name)) {
      throw new BadRequestException({
        success: false,
        error:
          'Preview is available for Word résumés. Download the file instead.',
      });
    }
    const html = await docxBufferToPreviewHtml(buffer);
    return {
      success: true as const,
      resumeId: assigned.resumeId,
      html,
    };
  }
}
