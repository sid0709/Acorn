import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { GetJobQueryDto } from './dto/get-job.query.dto';
import {
  BulkBidStatusDto,
  JobStatusApplierDto,
  UpdateJobBidStatusDto,
  UpdateJobPipelineStatusDto,
} from './dto/job-status-mutate.dto';
import {
  BulkWorkerPoolDto,
  UpdateJobWorkerPoolDto,
} from './dto/job-worker-pool.dto';
import { ApplyOtherCompanyJobsDto } from './dto/apply-other-company-jobs.dto';
import { ApplyJobsBulkDto } from './dto/apply-jobs-bulk.dto';
import { CompanyPostedJobsDto } from './dto/company-posted-jobs.dto';
import { JobCompanyApplyOthersService } from './job-company-apply-others.service';
import { JobCompanyPostedService } from './job-company-posted.service';
import { JobApplyBulkService } from './job-apply-bulk.service';
import { JobStatusMutateService } from './job-status-mutate.service';
import { JobWorkerPoolService } from './job-worker-pool.service';

@Controller('jobs')
export class JobsStatusController {
  constructor(
    private readonly mutate: JobStatusMutateService,
    private readonly workerPool: JobWorkerPoolService,
    private readonly companyApply: JobCompanyApplyOthersService,
    private readonly companyPosted: JobCompanyPostedService,
    private readonly applyBulk: JobApplyBulkService,
  ) {}

  @Post('company/posted-ids')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  postedIds(@Body() body: CompanyPostedJobsDto) {
    return this.companyPosted.postedIds(body);
  }

  @Post('company/apply-others')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  applyOthers(@Body() body: ApplyOtherCompanyJobsDto) {
    return this.companyApply.applyOthers(body);
  }

  @Post('apply/bulk')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  applyJobsBulk(@Body() body: ApplyJobsBulkDto) {
    return this.applyBulk.apply(body.applierName, body.jobIds);
  }

  @Post('bid-status/bulk')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  bulkBid(@Body() body: BulkBidStatusDto) {
    return this.mutate.setBidStatusBulk(
      body.applierName,
      body.status,
      body.jobs,
      body.mutationId,
    );
  }

  @Post('worker-pool/bulk')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  bulkWorkerPool(@Body() body: BulkWorkerPoolDto) {
    return this.workerPool.setStatusBulk(
      body.applierName,
      body.status,
      body.jobs,
      body.mutationId,
    );
  }

  @Get(':id/viewer-status')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  viewerStatus(@Param('id') id: string, @Query() query: GetJobQueryDto) {
    return this.mutate.viewerStatus(id, query.applierName || '');
  }

  @Post(':id/apply')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  apply(@Param('id') id: string, @Body() body: JobStatusApplierDto) {
    return this.mutate.apply(id, body.applierName, body.mutationId);
  }

  @Post(':id/status')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  status(@Param('id') id: string, @Body() body: UpdateJobPipelineStatusDto) {
    return this.mutate.setPipelineStatus(
      id,
      body.applierName,
      body.status,
      body.mutationId,
    );
  }

  @Post(':id/unapply')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  unapply(@Param('id') id: string, @Body() body: JobStatusApplierDto) {
    return this.mutate.unapply(id, body.applierName, body.mutationId);
  }

  @Post(':id/bid-status')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  bidStatus(@Param('id') id: string, @Body() body: UpdateJobBidStatusDto) {
    return this.mutate.setBidStatus(
      id,
      body.applierName,
      body.status,
      body.mutationId,
    );
  }

  @Post(':id/worker-pool')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  workerPoolStatus(
    @Param('id') id: string,
    @Body() body: UpdateJobWorkerPoolDto,
  ) {
    return this.workerPool.setStatus(
      id,
      body.applierName,
      body.status,
      body.mutationId,
    );
  }
}
