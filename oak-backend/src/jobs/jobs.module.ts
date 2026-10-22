import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { AuthModule } from '../auth/auth.module';
import { BidsModule } from '../bids/bids.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ResumesModule } from '../resumes/resumes.module';
import { AiAnalyzeController } from './ai-analyze/ai-analyze.controller';
import { AiAnalyzeProcessService } from './ai-analyze/ai-analyze-process.service';
import { AiAnalyzeSessionService } from './ai-analyze/ai-analyze-session.service';
import { RemoteReviewController } from './remote-review/remote-review.controller';
import { RemoteReviewService } from './remote-review/remote-review.service';
import { AiAnalyzeClaimService } from './claim/ai-analyze-claim.service';
import { TitleReviewClaimService } from './claim/title-review-claim.service';
import { AdminGuard } from '../common/guards/admin.guard';
import { CompanyBlockController } from './company-block/company-block.controller';
import { CompanyBlockSearchService } from './company-block/company-block-search.service';
import { CompanyBlockService } from './company-block/company-block.service';
import { CompanyBlockStoreService } from './company-block/company-block-store.service';
import { CompanyCatalogTotalService } from './company-catalog-total.service';
import { CompanyMembershipService } from './company-membership.service';
import { ExposeJobsController } from './expose-jobs.controller';
import { JobCatalogTotalService } from './job-catalog-total.service';
import { JobDedupeService } from './job-dedupe.service';
import { JobCompanyApplyOthersService } from './job-company-apply-others.service';
import { JobCompanyPostedService } from './job-company-posted.service';
import { JobStatusApplyBulkService } from './job-status-apply-bulk.service';
import { JobApplyBulkService } from './job-apply-bulk.service';
import { JobHardDeleteService } from './job-hard-delete.service';
import { JobStatusMutateService } from './job-status-mutate.service';
import { JobStatusService } from './job-status.service';
import { JobWorkerPoolService } from './job-worker-pool.service';
import { JobWorkerPoolTaskService } from './job-worker-pool-task.service';
import { JobsBulkController } from './jobs-bulk.controller';
//REVIEW:
import { JobsIngestController } from './jogs-ingest.controller';

import { JobsCompanyListService } from './jobs-company-list.service';
import { JobsCompanySourceListService } from './jobs-company-source-list.service';
import { JobsController } from './jobs.controller';
import { JobsDetailService } from './jobs-detail.service';
import { JobsQueryService } from './jobs-query.service';
import { JobsRemoveController } from './jobs-remove.controller';
import { JobsStatusController } from './jobs-status.controller';
import { JobsService } from './jobs.service';
import { JobRecommendFieldsService } from './recommend/job-recommend-fields.service';
import { JobRecommendStatusStore } from './recommend/job-recommend-status.store';
import { PersistPreviewRecommendService } from './recommend/persist-preview-recommend.service';
import { RecommendEligibilityService } from './recommend/recommend-eligibility.service';
import { RecommendOneService } from './recommend/recommend-one.service';
import { RecommendPersistService } from './recommend/recommend-persist.service';
import { RecommendResumesController } from './recommend/recommend-resumes.controller';
import { RecommendResumesService } from './recommend/recommend-resumes.service';
import { SetRecommendedResumeService } from './recommend/set-recommended-resume.service';
import { RegisterJobService } from './register-job.service';
import { SaveJobService } from './save-job.service';
import { SkillExtractController } from './skill-extract.controller';
import { TempJobPromotionService } from './temp-job-promotion.service';
import { TempJobQueueService } from './temp-job-queue.service';
import { TitleReviewApproveService } from './title-review-approve.service';
import { TitleReviewController } from './title-review.controller';
import { TitleReviewQueryService } from './title-review-query.service';
import { TitleReviewProcessService } from './title-review/title-review-process.service';
import { TitleReviewSessionService } from './title-review/title-review-session.service';

import { ExtensionsModule } from '../extensions/extensions.module';
@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AiModule,
    AiUsageModule,
    BidsModule,
    ResumesModule,
    ExtensionsModule,
  ],
  controllers: [
    //REVIEW: here
    TitleReviewController,
    AiAnalyzeController,
    RemoteReviewController,
    SkillExtractController,
    // ExposeJobsController,
    // JobsBulkController,
    JobsIngestController,
    JobsRemoveController,
    JobsStatusController,
    JobsController,
    RecommendResumesController,
    CompanyBlockController,
  ],
  providers: [
    AdminGuard,
    CompanyBlockStoreService,
    CompanyBlockSearchService,
    CompanyBlockService,
    JobsService,
    JobsQueryService,
    JobsCompanyListService,
    JobsDetailService,
    JobCatalogTotalService,
    CompanyCatalogTotalService,
    CompanyMembershipService,
    JobsCompanySourceListService,
    JobStatusService,
    JobStatusMutateService,
    JobStatusApplyBulkService,
    JobApplyBulkService,
    JobCompanyApplyOthersService,
    JobCompanyPostedService,
    JobWorkerPoolService,
    JobWorkerPoolTaskService,
    JobHardDeleteService,
    JobDedupeService,
    TempJobQueueService,
    TitleReviewClaimService,
    AiAnalyzeClaimService,
    TitleReviewQueryService,
    TitleReviewApproveService,
    TitleReviewProcessService,
    TitleReviewSessionService,
    AiAnalyzeProcessService,
    AiAnalyzeSessionService,
    RemoteReviewService,
    SaveJobService,
    RegisterJobService,
    TempJobPromotionService,
    RecommendResumesService,
    RecommendOneService,
    PersistPreviewRecommendService,
    RecommendPersistService,
    RecommendEligibilityService,
    SetRecommendedResumeService,
    JobRecommendStatusStore,
    JobRecommendFieldsService,
  ],
  exports: [
    JobRecommendFieldsService,
    JobStatusMutateService,
    JobWorkerPoolService,
    JobWorkerPoolTaskService,
    RecommendOneService,
  ],
})
export class JobsModule {}
