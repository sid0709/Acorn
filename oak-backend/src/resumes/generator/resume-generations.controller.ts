import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { ResumeGenerationsService } from './resume-generations.service';
import { contentDispositionAttachment } from './lib/resume-file-name';

@Controller('personal/resume-generations')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ResumeGenerationsController {
  constructor(private readonly generations: ResumeGenerationsService) {}

  @Get()
  list(
    @Query()
    query: {
      applierName?: string;
      limit?: string;
      offset?: string;
      search?: string;
      q?: string;
      status?: string;
      model?: string;
      provider?: string;
      from?: string;
      to?: string;
      sort?: string;
      includeFacets?: string;
    },
  ) {
    return this.generations.list(query);
  }

  @Get(':id/docx')
  async docx(
    @Param('id') id: string,
    @Query('applierName') applierName: string | undefined,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.generations.renderDocx(
      id,
      applierName,
    );
    const asAttachment =
      download == null ||
      String(download) === '1' ||
      String(download).toLowerCase() === 'true';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `${asAttachment ? contentDispositionAttachment(fileName) : `inline; filename="${fileName.replace(/["\\\r\n]/g, '_')}"`}`,
    );
    res.setHeader('Content-Length', buffer.length);
    return res.end(buffer);
  }

  @Get(':id')
  get(@Param('id') id: string, @Query('applierName') applierName?: string) {
    return this.generations.get(id, applierName);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Query('applierName') applierName?: string) {
    return this.generations.delete(id, applierName || '');
  }
}
