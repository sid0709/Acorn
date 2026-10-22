import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { AdminGuard } from '../common/guards/admin.guard';
import { PersonalModule } from '../personal/personal.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AiChatWithUsageService } from './ai-chat-with-usage.service';
import { AiUsageController } from './ai-usage.controller';
import { AiUsageMonitorService } from './ai-usage-monitor.service';
import { AiUsageQueryService } from './ai-usage-query.service';
import { AiUsageRecorderService } from './ai-usage-recorder.service';

@Module({
  imports: [PrismaModule, AuthModule, PersonalModule, AiModule],
  controllers: [AiUsageController],
  providers: [
    AdminGuard,
    AiUsageRecorderService,
    AiUsageQueryService,
    AiUsageMonitorService,
    AiChatWithUsageService,
  ],
  exports: [AiUsageRecorderService, AiChatWithUsageService],
})
export class AiUsageModule {}
