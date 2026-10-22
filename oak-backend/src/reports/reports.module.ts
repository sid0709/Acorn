import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportsApplicationsService } from './reports-applications.service';
import { ReportsController } from './reports.controller';
import { ReportsPostingCompaniesService } from './reports-posting-companies.service';
import { ReportsPostingsService } from './reports-postings.service';
import { ReportsService } from './reports.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportsPostingsService,
    ReportsPostingCompaniesService,
    ReportsApplicationsService,
  ],
})
export class ReportsModule {}
