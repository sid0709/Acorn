import { Injectable, NotFoundException } from '@nestjs/common';
import { RESUME_DOCX_MIME } from './constants/agent-job-resume.constants';
import { ResumeJobArtifactService } from './generator/resume-job-artifact.service';
import {
  contentDispositionAttachment,
  resumeDownloadFileName,
} from './generator/lib/resume-file-name';
import { docxBufferToPreviewHtml } from './lib/docx-preview-page';
import { ResumeStorageService } from './resume-storage.service';
import { AgentJobResumesService } from './agent-job-resumes.service';
import { isDocxRow } from './lib/is-docx-row';

@Injectable()
export class AgentJobResumeFileService {
  constructor(
    private readonly agentResumes: AgentJobResumesService,
    private readonly artifacts: ResumeJobArtifactService,
    private readonly storage: ResumeStorageService,
  ) {}

  async streamDocx(
    applierName: string,
    jobId: string,
  ): Promise<{
    buffer: Buffer;
    fileName: string;
  }> {
    const { buffer, fileName } = await this.loadDocx(applierName, jobId);
    return { buffer, fileName };
  }

  async previewHtml(applierName: string, jobId: string): Promise<string> {
    const { buffer } = await this.loadDocx(applierName, jobId);
    return docxBufferToPreviewHtml(buffer);
  }

  mimeType(): string {
    return RESUME_DOCX_MIME;
  }

  downloadDisposition(fileName: string): string {
    return contentDispositionAttachment(fileName);
  }

  private async loadDocx(
    applierName: string,
    jobId: string,
  ): Promise<{
    buffer: Buffer;
    fileName: string;
  }> {
    const name = String(applierName || '').trim();
    const id = String(jobId || '').trim();
    if (!name || !id) {
      throw new NotFoundException({
        success: false,
        error: 'Generated résumé not found for this job',
      });
    }

    let row = await this.agentResumes.requireGeneratedForJob(name, id);
    let buffer = isDocxRow(row) ? await this.download(row.storagePath) : null;
    if (!buffer) {
      row = await this.artifacts.ensureDocx(row);
      buffer = await this.download(row.storagePath);
    }
    if (!buffer) {
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
    };
  }

  private async download(storagePath: string): Promise<Buffer | null> {
    const path = String(storagePath || '').trim();
    if (!path) return null;
    const buffer = await this.storage.download(path);
    return buffer?.length ? buffer : null;
  }
}
