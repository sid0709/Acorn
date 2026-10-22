import { Injectable } from '@nestjs/common';
import type { ListJobsQueryDto } from './dto/list-jobs.query.dto';
import { JobsDetailService } from './jobs-detail.service';
import { JobsQueryService } from './jobs-query.service';

@Injectable()
export class JobsService {
  constructor(
    private readonly query: JobsQueryService,
    private readonly detail: JobsDetailService,
  ) {}

  list(query: ListJobsQueryDto) {
    return this.query.list(query);
  }

  getById(id: string, applierName?: string, profileId?: string) {
    return this.detail.getById(id, applierName, profileId);
  }
}
