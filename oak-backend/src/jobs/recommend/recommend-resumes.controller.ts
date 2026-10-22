import {
  Body,
  Controller,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { PersistRecommendedResumeDto } from './dto/persist-recommended-resume.dto';
import { RecommendResumesDto } from './dto/recommend-resumes.dto';
import { SetRecommendedResumeDto } from './dto/set-recommended-resume.dto';
import { PersistPreviewRecommendService } from './persist-preview-recommend.service';
import { RecommendResumesService } from './recommend-resumes.service';
import { SetRecommendedResumeService } from './set-recommended-resume.service';

@Controller('jobs')
export class RecommendResumesController {
  constructor(
    private readonly recommend: RecommendResumesService,
    private readonly persistPreview: PersistPreviewRecommendService,
    private readonly setRecommended: SetRecommendedResumeService,
  ) {}

  /** Recommend Library resume stacks. persist:false analyzes without writing vendor_tasks. */
  @Post('recommend-resumes')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  recommendResumes(@Body() body: RecommendResumesDto) {
    return this.recommend.recommendBulk(body);
  }

  /** Persist a previewed Library match after the job is Bid ready or Worker pool. */
  @Post('persist-recommended-resume')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  persistRecommendedResume(@Body() body: PersistRecommendedResumeDto) {
    return this.persistPreview.persistPreview(body);
  }

  /** Manually assign a Library resume stack to a Bid Ready or Worker pool job. */
  @Post('set-recommended-resume')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  setRecommendedResume(@Body() body: SetRecommendedResumeDto) {
    return this.setRecommended.setManual(body);
  }
}
