import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { PostingCompaniesQueryDto } from './dto/posting-companies.query.dto';
import { ReportsRangeQueryDto } from './dto/reports-range.query.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('job-source-summary')
  jobSourceSummary(@Query() query: ReportsRangeQueryDto) {
    return this.reports.jobSourceSummary(
      query.applierName,
      query.startDate,
      query.endDate,
      query.scrapeSource,
    );
  }

  @Get('daily-applications')
  dailyApplications(@Query() query: ReportsRangeQueryDto) {
    return this.reports.dailyApplications(
      query.applierName,
      query.startDate,
      query.endDate,
      query.scrapeSource,
    );
  }

  @Get('daily-postings-by-source')
  dailyPostingsBySource(@Query() query: ReportsRangeQueryDto) {
    return this.reports.dailyPostingsBySource(
      query.startDate,
      query.endDate,
      query.scrapeSource,
    );
  }

  @Get('daily-postings-by-source-and-scrape')
  dailyPostingsBySourceAndScrape(@Query() query: ReportsRangeQueryDto) {
    return this.reports.dailyPostingsBySourceAndScrape(
      query.startDate,
      query.endDate,
      query.scrapeSource,
      query.source,
    );
  }

  @Get('posting-companies')
  @UseGuards(AdminGuard)
  postingCompanies(@Query() query: PostingCompaniesQueryDto) {
    return this.reports.postingCompaniesList(query);
  }
}
