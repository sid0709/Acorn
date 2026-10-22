import { Injectable, Logger } from '@nestjs/common';
import { isUploadedTemplateId } from '../lib/parent-job-id';
import { ResumeTemplateService } from '../templates/resume-template.service';
import { buildDocxModelFromGeneration } from './lib/build-docx-model';
import { cleanString } from './lib/clean-string';
import { ResumeExportDocxService } from './resume-export-docx.service';

/**
 * Render a generation as DOCX: uploaded Word template when saved,
 * otherwise the structured Editor export. Job Search artifacts, editor
 * library rows, history download, and Oak Custom all use this path.
 */
@Injectable()
export class ResumeJobDocxService {
  private readonly logger = new Logger(ResumeJobDocxService.name);

  constructor(
    private readonly templates: ResumeTemplateService,
    private readonly docx: ResumeExportDocxService,
  ) {}

  async render(input: {
    ownerName: string;
    templateId: string | null;
    sections: Record<string, unknown>;
    identity: Record<string, unknown> | null;
    config?: Record<string, unknown> | null;
  }): Promise<Buffer> {
    if (isUploadedTemplateId(input.templateId)) {
      try {
        const filled = await this.templates.fill({
          templateId: String(input.templateId),
          ownerName: input.ownerName,
          sections: input.sections,
        });
        return filled.buffer;
      } catch (err) {
        this.logger.warn(
          `uploaded template fill failed, using structured export: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return this.renderStructured(input);
  }

  private async renderStructured(input: {
    sections: Record<string, unknown>;
    identity: Record<string, unknown> | null;
    config?: Record<string, unknown> | null;
  }): Promise<Buffer> {
    const config =
      input.config && typeof input.config === 'object' ? input.config : {};
    const identity = input.identity ?? {};
    const model = buildDocxModelFromGeneration({
      sections: input.sections,
      identity,
      config,
    });
    const theme =
      config.theme && typeof config.theme === 'object'
        ? (config.theme as Record<string, unknown>)
        : {};
    return this.docx.render({
      model,
      paper: theme.paper === 'a4' ? 'a4' : 'letter',
      marginInches: Number(theme.margin) || 0.6,
      font: cleanString(theme.font) || 'Georgia',
    });
  }
}
