import {
  Body,
  Controller,
  Get,
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
import { OakResumeFilesService } from './oak-resume-files.service';

@Controller('oak')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class OakController {
  private readonly logger = new Logger(OakController.name);

  constructor(
    private readonly analyze: OakAnalyzeService,
    private readonly matchOption: OakMatchOptionService,
    private readonly qa: OakQaService,
    private readonly resumeFiles: OakResumeFilesService,
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
        `ai-analyze failed for ${session.accountId}: ${
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
        `match-option failed for ${session.accountId}: ${
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
        `qa failed for ${session.accountId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }

  /** The account's primary Acorn Library résumé. */
  @Get('runtime-file')
  @UseGuards(OakAuthGuard)
  getRuntimeFile(@Req() req: OakAuthedRequest) {
    return this.resumeFiles.primary(req.oakSession!.accountId);
  }

  @Get('custom/library-resumes/:resumeId')
  @UseGuards(OakAuthGuard)
  getLibraryResume(
    @Req() req: OakAuthedRequest,
    @Param('resumeId') resumeId: string,
  ) {
    return this.resumeFiles.byId(req.oakSession!.accountId, resumeId);
  }

  /**
   * Worker pool is not ported to Acorn data yet, so the list is empty. The
   * sidebar's Fill and Custom tabs work without it.
   */
  @Get('jobs')
  @UseGuards(OakAuthGuard)
  listJobs() {
    return { success: true as const, jobs: [], total: 0 };
  }
}
