import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { identityRegexPattern } from '../lib/job-identity';
import { normalizeCompanyKey } from '../lib/company-key';
import { COMPANY_BLOCK_SEARCH_LIMIT } from './constants/company-block.constants';
import {
  mapCatalogBlockJob,
  mapRawBlockJob,
  type CompanyBlockJobHit,
} from './mappers/company-block-job.mapper';

const JOB_SELECT = {
  id: true,
  title: true,
  companyName: true,
  source: true,
  postedAt: true,
  applyLink: true,
} as const;

/**
 * Find catalog `jobs` and staging `temp_jobs` whose company matches a block rule.
 */
@Injectable()
export class CompanyBlockSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(companyName: string): Promise<{
    companyKey: string;
    jobs: CompanyBlockJobHit[];
    total: number;
    catalogCount: number;
    tempCount: number;
    truncated: boolean;
  }> {
    const companyKey = normalizeCompanyKey(companyName);
    if (!companyKey) {
      return emptyResult('');
    }

    const [catalog, tempRaw] = await Promise.all([
      this.findCatalogJobs(companyKey),
      this.findRawJobs('tempJob', companyKey),
    ]);

    const seen = new Set(catalog.map((job) => job.id));
    const temp: CompanyBlockJobHit[] = [];
    for (const row of tempRaw) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      temp.push(row);
    }

    const merged = [...catalog, ...temp].sort(byPostedAtDesc);
    const truncated = merged.length > COMPANY_BLOCK_SEARCH_LIMIT;
    const jobs = merged.slice(0, COMPANY_BLOCK_SEARCH_LIMIT);
    const catalogCount = jobs.filter((job) => job.collection === 'jobs').length;
    const tempCount = jobs.length - catalogCount;
    return {
      companyKey,
      jobs,
      total: merged.length,
      catalogCount,
      tempCount,
      truncated,
    };
  }

  private async findCatalogJobs(
    companyKey: string,
  ): Promise<CompanyBlockJobHit[]> {
    const company = await this.prisma.company.findUnique({
      where: { companyKey },
      select: { id: true },
    });
    const byCompanyId = company
      ? await this.prisma.job.findMany({
          where: { companyId: company.id },
          select: JOB_SELECT,
          orderBy: { postedAt: 'desc' },
          take: COMPANY_BLOCK_SEARCH_LIMIT + 1,
        })
      : [];

    const byName = await this.findRawJobs('job', companyKey);
    const seen = new Set<string>();
    const hits: CompanyBlockJobHit[] = [];
    for (const row of byCompanyId) {
      seen.add(row.id);
      hits.push(mapCatalogBlockJob(row, 'jobs'));
    }
    for (const row of byName) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      hits.push(row);
    }
    return hits;
  }

  private async findRawJobs(
    model: 'job' | 'tempJob',
    companyKey: string,
  ): Promise<CompanyBlockJobHit[]> {
    const collection = model === 'job' ? 'jobs' : 'temp_jobs';
    const filter = {
      companyName: {
        $regex: identityRegexPattern(companyKey),
        $options: 'i',
      },
    } as Prisma.InputJsonValue;
    const options = {
      projection: {
        _id: 1,
        title: 1,
        companyName: 1,
        source: 1,
        postedAt: 1,
        applyLink: 1,
      },
      sort: { postedAt: -1 },
      limit: COMPANY_BLOCK_SEARCH_LIMIT + 1,
    } as Prisma.InputJsonValue;

    const raw =
      model === 'job'
        ? await this.prisma.job.findRaw({ filter, options })
        : await this.prisma.tempJob.findRaw({ filter, options });
    const rows = Array.isArray(raw) ? raw : [];
    const hits: CompanyBlockJobHit[] = [];
    for (const row of rows) {
      const hit = mapRawBlockJob(row, companyKey, collection);
      if (hit) hits.push(hit);
    }
    return hits;
  }
}

function emptyResult(companyKey: string) {
  return {
    companyKey,
    jobs: [] as CompanyBlockJobHit[],
    total: 0,
    catalogCount: 0,
    tempCount: 0,
    truncated: false,
  };
}

function byPostedAtDesc(a: CompanyBlockJobHit, b: CompanyBlockJobHit) {
  const at = a.postedAt ? Date.parse(a.postedAt) : 0;
  const bt = b.postedAt ? Date.parse(b.postedAt) : 0;
  return bt - at;
}
