import { Injectable } from '@nestjs/common';
import { JobStatusMutateService } from '../../jobs/job-status-mutate.service';

@Injectable()
export class OakJobsMarkAppliedService {
  constructor(private readonly mutate: JobStatusMutateService) {}

  /**
   * Same Job Search apply: set job_statuses to applied on the existing row.
   * Do not clear Worker pool first — that deleted the Recommend snapshot.
   */
  async markApplied(applierName: string, jobId: string) {
    return this.mutate.apply(jobId, applierName);
  }
}
