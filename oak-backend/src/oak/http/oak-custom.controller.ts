import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { OakExtractJdService } from '../ai/oak-extract-jd.service';
import { OakAuthGuard, type OakAuthedRequest } from '../auth/oak-auth.guard';
import { OakCustomGenerateDto } from './dto/custom-generate.dto';
import { OakCustomRecommendDto } from './dto/custom-recommend.dto';
import { OakAnalyzeMetaDto } from './dto/analyze-meta.dto';
import { OakExtractJdDto } from './dto/extract-jd.dto';
import { OakCustomGenerateService } from './oak-custom-generate.service';
import { OakCustomLibraryResumeService } from './oak-custom-library-resume.service';
import { OakCustomRecommendService } from './oak-custom-recommend.service';
import { OakCustomResumeService } from './oak-custom-resume.service';

@Controller('oak/custom')
@UseGuards(OakAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class OakCustomController {
  constructor(
    private readonly generate: OakCustomGenerateService,
    private readonly recommend: OakCustomRecommendService,
    private readonly resumes: OakCustomResumeService,
    private readonly libraryResumes: OakCustomLibraryResumeService,
    private readonly extractJd: OakExtractJdService,
  ) {}

  @Post('extract-jd')
  extractJobDescription(
    @Req() req: OakAuthedRequest,
    @Body() dto: OakExtractJdDto,
  ) {
    const session = req.oakSession!;
    return this.extractJd.extract({
      profileId: session.profileId,
      applierName: session.applierName,
      pageText: dto.pageText,
      meta: dto.meta,
    });
  }

  @Post('analyze-meta')
  analyzeMeta(@Req() req: OakAuthedRequest, @Body() dto: OakAnalyzeMetaDto) {
    const session = req.oakSession!;
    return this.extractJd.extract({
      profileId: session.profileId,
      applierName: session.applierName,
      meta: dto.meta,
    });
  }

  @Post('generate')
  @HttpCode(202)
  startGenerate(
    @Req() req: OakAuthedRequest,
    @Body() dto: OakCustomGenerateDto,
  ) {
    return this.generate.enqueueForSession(req.oakSession!, dto.jobDescription);
  }

  @Post('generate/:inputId/continue')
  async continueGenerate(
    @Req() req: OakAuthedRequest,
    @Param('inputId') inputId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.generate.continueForSession(
      req.oakSession!,
      inputId,
    );
    res.status(result.recovered ? 200 : 202);
    return {
      ok: true as const,
      inputId: result.inputId,
      recovered: result.recovered,
      resumedFromStep: result.resumedFromStep,
      jobDescription: result.jobDescription,
      task: result.task ?? null,
    };
  }

  @Post('recommend')
  recommendLibrary(
    @Req() req: OakAuthedRequest,
    @Body() dto: OakCustomRecommendDto,
  ) {
    return this.recommend.recommendForSession(req.oakSession!, dto);
  }

  @Get('generate/:inputId')
  async pollGenerate(
    @Req() req: OakAuthedRequest,
    @Param('inputId') inputId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.generate.pollForSession(req.oakSession!, inputId);
    res.status(result.httpStatus);
    return result.body;
  }

  @Get('library-resumes/:resumeId/preview')
  previewLibraryResume(
    @Req() req: OakAuthedRequest,
    @Param('resumeId') resumeId: string,
  ) {
    return this.libraryResumes.previewHtml(
      req.oakSession!.applierName,
      resumeId,
    );
  }

  @Get('library-resumes/:resumeId')
  getLibraryResume(
    @Req() req: OakAuthedRequest,
    @Param('resumeId') resumeId: string,
  ) {
    return this.libraryResumes.getFile(req.oakSession!.applierName, resumeId);
  }

  @Get('resumes/:generationId/preview')
  previewResume(
    @Req() req: OakAuthedRequest,
    @Param('generationId') generationId: string,
  ) {
    return this.resumes.previewHtml(req.oakSession!.applierName, generationId);
  }

  @Get('resumes/:generationId')
  getResume(
    @Req() req: OakAuthedRequest,
    @Param('generationId') generationId: string,
  ) {
    return this.resumes.getFile(req.oakSession!.applierName, generationId);
  }
}
