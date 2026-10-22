import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BackgroundTasksModule } from '../background-tasks/background-tasks.module';
import { AdminGuard } from '../common/guards/admin.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { HealthController } from './health.controller';
import { MetricsServerService } from './metrics-server.service';
import { MonitorLoopService } from './monitor-loop.service';
import { PrometheusClientService } from './prometheus-client.service';
import { StatusAdminController } from './status-admin.controller';
import { StatusController } from './status.controller';
import { StatusStoreService } from './status-store.service';

@Module({
  imports: [PrismaModule, AuthModule, BackgroundTasksModule],
  controllers: [StatusController, StatusAdminController, HealthController],
  providers: [
    PrometheusClientService,
    StatusStoreService,
    MonitorLoopService,
    MetricsServerService,
    AdminGuard,
  ],
  exports: [StatusStoreService],
})
export class StatusModule {}
