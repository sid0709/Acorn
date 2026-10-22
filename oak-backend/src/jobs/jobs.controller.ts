import {
  Controller,
  Get,
  Param,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { GetJobQueryDto } from './dto/get-job.query.dto';
import { ListJobsQueryDto } from './dto/list-jobs.query.dto';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** Read-only Job Search catalog. Filters + pagination via query string. */
  @Get()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  list(@Query() query: ListJobsQueryDto) {
    return this.jobs.list(query);
  }

  /** Full job for View JD — includes description (not on list). */
  @Get(':id')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  getById(@Param('id') id: string, @Query() query: GetJobQueryDto) {
    return this.jobs.getById(id, query.applierName, query.profileId);
  }
}
