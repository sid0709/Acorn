import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { AuthModule } from '../auth/auth.module';
import { BackgroundTasksModule } from '../background-tasks/background-tasks.module';
import { PersonalModule } from '../personal/personal.module';
import { ImapClientService } from './imap/imap-client.service';
import { ImapPoolService } from './imap/imap-pool.service';
import { MailAiLabelApplyService } from './mail-ai-label-apply.service';
import { MailAiLabelBacklogService } from './mail-ai-label-backlog.service';
import { MailAiLabelClassifyService } from './mail-ai-label-classify.service';
import { MailAiLabelLoadService } from './mail-ai-label-load.service';
import { MailAiLabelService } from './mail-ai-label.service';
import { MailAiWriteService } from './mail-ai-write.service';
import { MailCacheService } from './mail-cache.service';
import { MailController } from './mail.controller';
import { MailCredentialsService } from './mail-credentials.service';
import { MailLabelDefinitionsService } from './mail-label-definitions.service';
import { MailService } from './mail.service';
import { MailStatsService } from './mail-stats.service';
import { MailSyncService } from './mail-sync.service';
import { SmtpClientService } from './smtp/smtp-client.service';

@Module({
  imports: [
    AuthModule,
    PersonalModule,
    AiModule,
    AiUsageModule,
    forwardRef(() => BackgroundTasksModule),
  ],
  controllers: [MailController],
  providers: [
    MailService,
    MailCredentialsService,
    MailCacheService,
    MailSyncService,
    MailLabelDefinitionsService,
    MailAiLabelClassifyService,
    MailAiLabelLoadService,
    MailAiLabelApplyService,
    MailAiLabelService,
    MailAiLabelBacklogService,
    MailAiWriteService,
    MailStatsService,
    ImapPoolService,
    ImapClientService,
    SmtpClientService,
  ],
  exports: [
    MailService,
    MailCredentialsService,
    MailAiLabelService,
    MailAiLabelBacklogService,
    MailLabelDefinitionsService,
    ImapClientService,
  ],
})
export class MailModule {}
