import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { OakAuthGuard, type OakAuthedRequest } from '../auth/oak-auth.guard';
import { OakAnalyzeService } from '../ai/oak-analyze.service';
import { OakMatchOptionService } from '../ai/oak-match-option.service';
import { OakQaService } from '../ai/oak-qa.service';
import { OakAiAnalyzeDto } from './dto/ai-analyze.dto';
import { OakMatchOptionDto } from './dto/match-option.dto';
import { OakQaDto } from './dto/qa.dto';
import { OakJobsMarkAppliedService } from './oak-jobs-mark-applied.service';
import { OakJobGenerateService } from './oak-job-generate.service';
import { OakJobsService } from './oak-jobs.service';
import { OakRecommendedResumeService } from './oak-recommended-resume.service';
import { OakRuntimeFileService } from './oak-runtime-file.service';

@Controller('oak')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class OakController {
  private readonly logger = new Logger(OakController.name);

  constructor(
    private readonly analyze: OakAnalyzeService,
    private readonly matchOption: OakMatchOptionService,
    private readonly qa: OakQaService,
    private readonly runtimeFiles: OakRuntimeFileService,
    private readonly jobs: OakJobsService,
    private readonly jobGenerate: OakJobGenerateService,
    private readonly markApplied: OakJobsMarkAppliedService,
    private readonly recommendedResume: OakRecommendedResumeService,
  ) {}

  /** Unauthenticated liveness probe — must not disclose who is connected. */
  @Get('health')
  health() {
    return { ok: true };
  }

  @Post('ai-analyze')
  @UseGuards(OakAuthGuard)
  async aiAnalyze(@Req() req: OakAuthedRequest, @Body() dto: OakAiAnalyzeDto) {
    const session = req.oakSession!;
    try {
      return await this.analyze.analyze({
        profileId: session.profileId,
        applierName: session.applierName,
        pureTree: dto.pureTree,
        metaTree: dto.metaTree,
        page: dto.page ?? null,
      });
    } catch (err) {
      this.logger.warn(
        `ai-analyze failed for ${session.applierName}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }

  @Post('match-option')
  @UseGuards(OakAuthGuard)
  async match(@Req() req: OakAuthedRequest, @Body() dto: OakMatchOptionDto) {
    const session = req.oakSession!;
    try {
      return await this.matchOption.match({
        profileId: session.profileId,
        applierName: session.applierName,
        intendedValue: dto.intendedValue,
        options: dto.options,
        fieldLabel: dto.fieldLabel,
        typedQuery: dto.typedQuery,
      });
    } catch (err) {
      this.logger.warn(
        `match-option failed for ${session.applierName}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        ok: false as const,
        matched_option: null,
        confidence: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  @Post('qa')
  @UseGuards(OakAuthGuard)
  async qaAnswer(@Req() req: OakAuthedRequest, @Body() dto: OakQaDto) {
    const session = req.oakSession!;
    try {
      return await this.qa.answer({
        profileId: session.profileId,
        applierName: session.applierName,
        question: dto.question,
        page: dto.page ?? null,
      });
    } catch (err) {
      this.logger.warn(
        `qa failed for ${session.applierName}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }

  @Get('runtime-file')
  @UseGuards(OakAuthGuard)
  getRuntimeFile() {
    return this.runtimeFiles.getRuntimeFile();
  }

  @Get('jobs')
  @UseGuards(OakAuthGuard)
  listJobs(@Req() req: OakAuthedRequest) {
    return this.jobs.list(req.oakSession!.applierName);
  }

  /** Stored Worker-pool job including Job.description for Fill JD display. */
  @Get('jobs/:jobId')
  @UseGuards(OakAuthGuard)
  getJob(@Req() req: OakAuthedRequest, @Param('jobId') jobId: string) {
    return this.jobs.getOne(req.oakSession!.applierName, jobId);
  }

  /** Fill generate from the stored job JD (does not analyze meta). */
  @Post('jobs/:jobId/generate')
  @UseGuards(OakAuthGuard)
  @HttpCode(202)
  generateFromStoredJd(
    @Req() req: OakAuthedRequest,
    @Param('jobId') jobId: string,
  ) {
    return this.jobGenerate.enqueueForJob(req.oakSession!, jobId);
  }

  /** Clear Worker pool, then mark applied (same Job Search apply path). */
  @Post('jobs/:jobId/mark-applied')
  @UseGuards(OakAuthGuard)
  markJobApplied(@Req() req: OakAuthedRequest, @Param('jobId') jobId: string) {
    return this.markApplied.markApplied(req.oakSession!.applierName, jobId);
  }

  /** HTML preview of the generated Worker-pool résumé, or the assigned Library Word file. */
  @Get('jobs/:jobId/resume-preview')
  @UseGuards(OakAuthGuard)
  previewGeneratedResume(
    @Req() req: OakAuthedRequest,
    @Param('jobId') jobId: string,
  ) {
    return this.recommendedResume.previewGenerated(
      req.oakSession!.applierName,
      jobId,
    );
  }

  /** Generated Worker-pool résumé, or Library resume assigned by Job Search Recommend. */
  @Get('jobs/:jobId/recommended-resume')
  @UseGuards(OakAuthGuard)
  getRecommendedResume(
    @Req() req: OakAuthedRequest,
    @Param('jobId') jobId: string,
  ) {
    return this.recommendedResume.getForJob(req.oakSession!.applierName, jobId);
  }
}
