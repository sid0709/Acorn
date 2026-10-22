import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  contentDispositionAttachment,
  resumeDownloadFileName,
} from '../generator/lib/resume-file-name';
import {
  FillResumeTemplateDto,
  ListResumeTemplatesQueryDto,
  UploadResumeTemplateDto,
} from './dto/resume-template.dto';
import { ResumeTemplateService } from './resume-template.service';

@Controller('personal')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ResumeTemplateController {
  constructor(private readonly templates: ResumeTemplateService) {}

  @Get('resume-templates')
  async list(@Query() query: ListResumeTemplatesQueryDto) {
    const templates = await this.templates.list(query.ownerName);
    return { success: true as const, templates };
  }

  @Post('resume-templates')
  async upload(@Body() body: UploadResumeTemplateDto) {
    const template = await this.templates.create(body);
    return { success: true as const, template };
  }

  @Delete('resume-templates/:id')
  async remove(@Param('id') id: string, @Query('ownerName') ownerName: string) {
    const result = await this.templates.delete(id, ownerName);
    return { success: true as const, ...result };
  }

  @Post('resume-template-fill')
  async fill(@Body() body: FillResumeTemplateDto, @Res() res: Response) {
    const result = await this.templates.fill(body);
    const fileName = resumeDownloadFileName(body.fileName || result.fileName);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      contentDispositionAttachment(fileName),
    );
    res.setHeader('Content-Length', result.buffer.length);
    if (result.warnings.length) {
      res.setHeader(
        'X-Resume-Warnings',
        encodeURIComponent(result.warnings.join(' | ')),
      );
    }
    return res.end(result.buffer);
  }

  @Post('resume-template-preview')
  async preview(@Body() body: FillResumeTemplateDto) {
    const result = await this.templates.previewHtml(body);
    return { success: true as const, ...result };
  }

  @Post('resume-template-preview-images')
  async previewImages(@Body() body: FillResumeTemplateDto) {
    const result = await this.templates.previewImages(body);
    return { success: true as const, ...result };
  }
}
