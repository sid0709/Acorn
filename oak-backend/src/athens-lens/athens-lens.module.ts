import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { BidsModule } from '../bids/bids.module';
import { MailModule } from '../mail/mail.module';
import { PersonalModule } from '../personal/personal.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AthensLensAskAiController } from './athens-lens-ask-ai.controller';
import { AthensLensAuthController } from './athens-lens-auth.controller';
import { AthensLensController } from './athens-lens.controller';
import { LensAskAiService } from './lens-ask-ai.service';
import { LensAuthGuard } from './lens-auth.guard';
import { LensAuthService } from './lens-auth.service';
import { LensGmailService } from './lens-gmail.service';
import { LensJobsService } from './lens-jobs.service';
import { LensSessionService } from './lens-session.service';

@Module({
  imports: [
    PrismaModule,
    BidsModule,
    AiModule,
    AiUsageModule,
    PersonalModule,
    MailModule,
  ],
  controllers: [
    AthensLensAuthController,
    AthensLensAskAiController,
    AthensLensController,
  ],
  providers: [
    LensSessionService,
    LensAuthService,
    LensAuthGuard,
    LensJobsService,
    LensAskAiService,
    LensGmailService,
  ],
})
export class AthensLensModule {}
