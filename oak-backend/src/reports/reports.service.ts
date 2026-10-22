import { Injectable } from '@nestjs/common';
import { parseSources } from '../jobs/lib/jobs-mongo-match';
import { ReportsApplicationsService } from './reports-applications.service';
import { ReportsPostingCompaniesService } from './reports-posting-companies.service';
import { ReportsPostingsService } from './reports-postings.service';
import type { PostingCompaniesQueryDto } from './dto/posting-companies.query.dto';
import { okReportData } from './mappers/reports-response.mapper';

@Injectable()
export class ReportsService {
  constructor(
    private readonly postings: ReportsPostingsService,
    private readonly applications: ReportsApplicationsService,
    private readonly postingCompanies: ReportsPostingCompaniesService,
  ) {}

  async jobSourceSummary(
    applierName?: string,
    startDate?: string,
    endDate?: string,
    scrapeSource?: string,
  ) {
    const scrapeSources = parseSources(scrapeSource);
    const [postingsBySource, statusBySource] = await Promise.all([
      this.postings.postingsBySource(startDate, endDate, scrapeSources),
      this.applications.statusCountsBySource(
        applierName,
        startDate,
        endDate,
        scrapeSources,
      ),
    ]);
    const data = this.postings.mergeSourceSummary(
      postingsBySource,
      statusBySource.applied,
      statusBySource.scheduled,
      statusBySource.declined,
    );
    return okReportData(data);
  }

  async dailyApplications(
    applierName?: string,
    startDate?: string,
    endDate?: string,
    scrapeSource?: string,
  ) {
    const data = await this.applications.dailyApplications(
      applierName,
      startDate,
      endDate,
      parseSources(scrapeSource),
    );
    return okReportData(data);
  }

  async dailyPostingsBySource(
    startDate?: string,
    endDate?: string,
    scrapeSource?: string,
  ) {
    const data = await this.postings.dailyBySource(
      startDate,
      endDate,
      parseSources(scrapeSource),
    );
    return okReportData(data);
  }

  async dailyPostingsBySourceAndScrape(
    startDate?: string,
    endDate?: string,
    scrapeSource?: string,
    source?: string,
  ) {
    const data = await this.postings.dailyBySourceAndScrape(
      startDate,
      endDate,
      parseSources(scrapeSource),
      parseSources(source),
    );
    return okReportData(data);
  }

  postingCompaniesList(query: PostingCompaniesQueryDto) {
    return this.postingCompanies.list(query);
  }
}
