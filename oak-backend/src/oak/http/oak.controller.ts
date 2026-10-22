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
import { AcornUsageService } from '../../acorn/acorn-usage.service';
import { currentAcornContext } from '../../acorn/request-context';
import { OakAuthGuard, type OakAuthedRequest } from '../auth/oak-auth.guard';
import { OakAnalyzeService } from '../ai/oak-analyze.service';
import { OakMatchOptionService } from '../ai/oak-match-option.service';
import { OakQaService } from '../ai/oak-qa.service';
import { OakAiAnalyzeDto } from './dto/ai-analyze.dto';
import { OakMatchOptionDto } from './dto/match-option.dto';
import { OakQaDto } from './dto/qa.dto';
import { OakJdShotDto } from './dto/jd-shot.dto';
import { OakSentDto } from './dto/sent.dto';
import { OakEmailsService } from './oak-emails.service';
import { OakJdShotService } from './oak-jd-shot.service';
import { OakResumeFilesService } from './oak-resume-files.service';
import { OakSentService } from './oak-sent.service';

@Controller('oak')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class OakController {
  private readonly logger = new Logger(OakController.name);

  constructor(
    private readonly analyze: OakAnalyzeService,
    private readonly matchOption: OakMatchOptionService,
    private readonly qa: OakQaService,
    private readonly resumeFiles: OakResumeFilesService,
    private readonly jdShot: OakJdShotService,
    private readonly sent: OakSentService,
    private readonly emails: OakEmailsService,
    private readonly usage: AcornUsageService,
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

  /** JD shot: is this page a job posting, and which Library résumé fits it. */
  @Post('jd-shot')
  @UseGuards(OakAuthGuard)
  jdShotRun(@Req() req: OakAuthedRequest, @Body() dto: OakJdShotDto) {
    return this.jdShot.run(req.oakToken!, dto.pageText);
  }

  /** What the models cost for the tab named by X-Acorn-Tab. */
  @Get('tab-cost')
  @UseGuards(OakAuthGuard)
  async tabCost(@Req() req: OakAuthedRequest) {
    const { tabKey } = currentAcornContext();
    const cost = await this.usage.tabCost(req.oakSession!.accountId, tabKey);
    return { success: true as const, ...cost };
  }

  /** Sent: count the page as an application, with its cost and a full-page screenshot. */
  @Post('sent')
  @UseGuards(OakAuthGuard)
  markSent(@Req() req: OakAuthedRequest, @Body() dto: OakSentDto) {
    return this.sent.record(req.oakToken!, req.oakSession!, dto);
  }

  /** Verification emails the Gmail watcher labelled, newest first. */
  @Get('emails')
  @UseGuards(OakAuthGuard)
  listEmails(@Req() req: OakAuthedRequest) {
    return this.emails.list(req.oakToken!);
  }

  /** One labelled email in full, read live from Gmail. */
  @Get('emails/:mailboxId/:id')
  @UseGuards(OakAuthGuard)
  getEmail(
    @Req() req: OakAuthedRequest,
    @Param('mailboxId') mailboxId: string,
    @Param('id') id: string,
  ) {
    return this.emails.get(req.oakToken!, mailboxId, id);
  }

  /** The account's primary Acorn Library résumé. */
  @Get('runtime-file')
  @UseGuards(OakAuthGuard)
  getRuntimeFile(@Req() req: OakAuthedRequest) {
    const session = req.oakSession!;
    return this.resumeFiles.primary(session.accountId, session.applierName);
  }

  @Get('custom/library-resumes/:resumeId')
  @UseGuards(OakAuthGuard)
  getLibraryResume(
    @Req() req: OakAuthedRequest,
    @Param('resumeId') resumeId: string,
  ) {
    const session = req.oakSession!;
    return this.resumeFiles.byId(
      session.accountId,
      session.applierName,
      resumeId,
    );
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
