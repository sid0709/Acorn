import { Module } from '@nestjs/common';
import { AiUsageModule } from './ai-usage/ai-usage.module';
import { AthensLensModule } from './athens-lens/athens-lens.module';
import { AuthModule } from './auth/auth.module';
import { BackgroundTasksModule } from './background-tasks/background-tasks.module';
import { BidsModule } from './bids/bids.module';
import { FirebaseModule } from './firebase/firebase.module';
import { JobsModule } from './jobs/jobs.module';
import { MailModule } from './mail/mail.module';
import { OakModule } from './oak/oak.module';
import { PersonalModule } from './personal/personal.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { ResumesModule } from './resumes/resumes.module';
import { StatusModule } from './status/status.module';
import { ExtensionsModule } from './extensions/extensions.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PersonalModule,
    BidsModule,
    JobsModule,
    FirebaseModule,
    ResumesModule,
    MailModule,
    BackgroundTasksModule,
    AthensLensModule,
    OakModule,
    StatusModule,
    AiUsageModule,
    ReportsModule,

    ExtensionsModule,
  ],
})
export class AppModule {}
