import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { StartAiSessionDto } from './dto/start-ai-session.dto';
import { ApproveTitleReviewJobsDto } from './dto/approve-title-review-jobs.dto';
import { ListTitleReviewQueryDto } from './dto/list-title-review.query.dto';
import { RemoveTitleReviewJobsDto } from './dto/remove-title-review-jobs.dto';
import { JobHardDeleteService } from './job-hard-delete.service';
import { TitleReviewApproveService } from './title-review-approve.service';
import { TitleReviewQueryService } from './title-review-query.service';
import { TitleReviewSessionService } from './title-review/title-review-session.service';

@Controller('jobs/title-review')
export class TitleReviewController {
  constructor(
    private readonly titleReview: TitleReviewQueryService,
    private readonly session: TitleReviewSessionService,
    private readonly hardDelete: JobHardDeleteService,
    private readonly approveService: TitleReviewApproveService,
  ) {}

  @Get('status')
  status() {
    return this.session.status();
  }

  @Post('start')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  start(@Body() body: StartAiSessionDto) {
    return this.session.start(body);
  }

  @Post('stop')
  stop() {
    return this.session.stop();
  }

  /** Mark selected temp_jobs APPROVED → eligible for AI Analyze. */
  @Post('approve')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  approve(@Body() body: ApproveTitleReviewJobsDto) {
    if (!body.ids?.length) {
      throw new BadRequestException({
        success: false,
        error: 'Missing ids array',
        message: 'Missing ids array',
      });
    }
    return this.approveService.approve(body.ids);
  }

  /** Permanent hard delete from staging `temp_jobs`. */
  @Post('remove')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  remove(@Body() body: RemoveTitleReviewJobsDto) {
    if (!body.ids?.length) {
      throw new BadRequestException({
        success: false,
        error: 'Missing ids array',
        message: 'Missing ids array',
      });
    }
    return this.hardDelete.deleteTempJobs(body.ids);
  }

  @Get('bootstrap')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async bootstrap(@Query() query: ListTitleReviewQueryDto) {
    const [session, list] = await Promise.all([
      this.session.status(),
      this.titleReview.list(query),
    ]);
    return { ...list, session };
  }

  @Get()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  list(@Query() query: ListTitleReviewQueryDto) {
    return this.titleReview.list(query);
  }
}
