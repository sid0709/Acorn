import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { FirebaseModule } from '../firebase/firebase.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BidLifecycleService } from './bid-lifecycle.service';
import { BidResultsController } from './bid-results.controller';
import { BidResultsService } from './bid-results.service';
import { BidResultsListService } from './bid-results-list.service';
import { BidResultsReportService } from './bid-results-report.service';
import { BidReviewEventsService } from './bid-review-events.service';
import { BidStatusQueueService } from './bid-status-queue.service';
import { BidRecordingUploadService } from './recording/bid-recording-upload.service';
import { UploadSessionService } from './recording/upload-session.service';
import { VendorTaskService } from './vendor-task.service';

@Module({
  imports: [PrismaModule, FirebaseModule, AiModule, AuthModule],
  controllers: [BidResultsController],
  providers: [
    VendorTaskService,
    BidReviewEventsService,
    BidStatusQueueService,
    BidResultsService,
    BidResultsListService,
    BidResultsReportService,
    BidLifecycleService,
    UploadSessionService,
    BidRecordingUploadService,
  ],
  exports: [
    VendorTaskService,
    BidReviewEventsService,
    BidStatusQueueService,
    BidResultsService,
    BidLifecycleService,
    BidRecordingUploadService,
    UploadSessionService,
  ],
})
export class BidsModule {}
