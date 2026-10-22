import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { MailModule } from '../mail/mail.module';
import { ResumesModule } from '../resumes/resumes.module';
import { BackgroundTasksController } from './background-tasks.controller';
import { BackgroundTasksEventsController } from './background-tasks-events.controller';
import { BackgroundTasksService } from './background-tasks.service';
import { TaskStoreService } from './task-store.service';
import { BackgroundTaskWorker } from './worker/background-task.worker';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => MailModule),
    forwardRef(() => ResumesModule),
    forwardRef(() => JobsModule),
  ],
  controllers: [BackgroundTasksEventsController, BackgroundTasksController],
  providers: [TaskStoreService, BackgroundTasksService, BackgroundTaskWorker],
  exports: [BackgroundTasksService],
})
export class BackgroundTasksModule {}
