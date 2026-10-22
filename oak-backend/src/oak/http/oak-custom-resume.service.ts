import { Injectable } from '@nestjs/common';
import { JOB_OBJECT_ID_PATTERN } from '../../jobs/lib/normalize-job-ids';
import { PrismaService } from '../../prisma/prisma.service';
import { RESUME_DOCX_MIME } from '../../resumes/constants/agent-job-resume.constants';
import { ResumeGenerationLibraryService } from '../../resumes/generator/resume-generation-library.service';
import { cleanString } from '../../resumes/generator/lib/clean-string';
import { docxBufferToPreviewHtml } from '../../resumes/lib/docx-preview-page';
import { OAK_CUSTOM_RESUME_KEY } from '../constants/oak.constants';

@Injectable()
export class OakCustomResumeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly library: ResumeGenerationLibraryService,
  ) {}

  async existsForGeneration(
    applierName: string,
    generationId: string,
  ): Promise<boolean> {
    const id = cleanString(generationId);
    if (!JOB_OBJECT_ID_PATTERN.test(id)) return false;
    const run = await this.prisma.resumeGeneration.findFirst({
      where: { id, applierName, status: 'completed' },
      select: { sections: true },
    });
    return Boolean(run?.sections && typeof run.sections === 'object');
  }

  async getFile(applierName: string, generationId: string) {
    const { buffer, fileName, resumeId } = await this.library.loadDocx(
      applierName,
      generationId,
    );
    return {
      success: true as const,
      generationId: cleanString(generationId),
      resumeId,
      source: 'generated' as const,
      stack: 'Generated',
      file: {
        key: OAK_CUSTOM_RESUME_KEY,
        name: fileName,
        mimeType: RESUME_DOCX_MIME,
        base64: buffer.toString('base64'),
      },
    };
  }

  async previewHtml(applierName: string, generationId: string) {
    const { buffer, resumeId } = await this.library.loadDocx(
      applierName,
      generationId,
    );
    const html = await docxBufferToPreviewHtml(buffer);
    return {
      success: true as const,
      generationId: cleanString(generationId),
      resumeId,
      html,
    };
  }
}
