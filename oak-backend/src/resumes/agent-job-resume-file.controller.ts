import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { AgentJobResumeFileService } from './agent-job-resume-file.service';

/**
 * Job Search card + Bid preview. Path is singular to match the Athens client.
 */
@Controller('personal/agent-job-resume')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class AgentJobResumeFileController {
  constructor(private readonly files: AgentJobResumeFileService) {}

  @Get(':jobId/docx')
  async docx(
    @Param('jobId') jobId: string,
    @Query('applierName') applierName: string | undefined,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.files.streamDocx(
      applierName || '',
      jobId,
    );
    res.setHeader('Content-Type', this.files.mimeType());
    res.setHeader(
      'Content-Disposition',
      this.files.downloadDisposition(fileName),
    );
    res.setHeader('Content-Length', buffer.length);
    return res.end(buffer);
  }

  @Get(':jobId/preview')
  async preview(
    @Param('jobId') jobId: string,
    @Query('applierName') applierName: string | undefined,
    @Res() res: Response,
  ) {
    const html = await this.files.previewHtml(applierName || '', jobId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(html);
  }
}
