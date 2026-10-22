import {
  Body,
  Controller,
  Post,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { ExportDocxDto } from './dto/export-docx.dto';
import {
  contentDispositionAttachment,
  resumeDownloadFileName,
} from './lib/resume-file-name';
import { ResumeExportDocxService } from './resume-export-docx.service';

@Controller('personal')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ResumeExportController {
  constructor(private readonly docx: ResumeExportDocxService) {}

  @Post('resume-docx')
  async resumeDocx(@Body() body: ExportDocxDto, @Res() res: Response) {
    const buffer = await this.docx.render(body);
    const fileName = resumeDownloadFileName(body.fileName || 'resume.docx');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      contentDispositionAttachment(fileName),
    );
    res.setHeader('Content-Length', buffer.length);
    return res.end(buffer);
  }
}
