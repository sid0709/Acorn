import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toMongoDate } from '../prisma/mongo-standalone';
import {
  JOB_DEDUP_WINDOW_DAYS,
  jobDedupCutoff,
} from './constants/job-ingest.config';
import { pickIdentityHit, pickRawId } from './lib/job-dedupe-raw';
import { buildJobIdentityKeys, identityRegexPattern } from './lib/job-identity';

export type DuplicateHit = {
  id: string;
  reason: string;
  code: 'DUPLICATE_JOB_ID' | 'DUPLICATE_APPLY_LINK' | 'DUPLICATE_COMPANY_TITLE';
};

type DedupeInput = {
  legacyId?: string;
  applyLink?: string;
  companyName?: string;
  title?: string;
};

/**
 * Cross-collection dedupe for Extension / LI-scrapper ingest.
 * Looks in both `temp_jobs` and `jobs` within JOB_DEDUP_WINDOW_DAYS
 * (legacyId is always treated as a hard duplicate).
 * Company+title is checked even when applyLink differs.
 */
@Injectable()
export class JobDedupeService {
  constructor(private readonly prisma: PrismaService) {}

  async findDuplicate(input: DedupeInput): Promise<DuplicateHit | null> {
    const legacyId = String(input.legacyId || '').trim();
    if (legacyId) {
      const byLegacy = await this.findByLegacyId(legacyId);
      if (byLegacy) {
        return {
          id: byLegacy.id,
          code: 'DUPLICATE_JOB_ID',
          reason: 'Duplicate jobID already exists',
        };
      }
    }

    const cutoff = jobDedupCutoff();
    const applyLink = String(input.applyLink || '').trim();
    if (applyLink) {
      const byUrl = await this.findByApplyLink(applyLink, cutoff);
      if (byUrl) {
        return {
          id: byUrl.id,
          code: 'DUPLICATE_APPLY_LINK',
          reason: `Job with this URL has been posted within the last ${JOB_DEDUP_WINDOW_DAYS} days`,
        };
      }
    }

    const companyName = String(input.companyName || '').trim();
    const title = String(input.title || '').trim();
    const identity = buildJobIdentityKeys(companyName, title);
    if (identity) {
      const byIdentity =
        (await this.findByCompanyTitleExact(companyName, title, cutoff)) ??
        (await this.findByCompanyTitle(
          identity.companyKey,
          identity.titleKey,
          cutoff,
        ));
      if (byIdentity) {
        return {
          id: byIdentity.id,
          code: 'DUPLICATE_COMPANY_TITLE',
          reason: `Duplicate job with this company and title was added within the last ${JOB_DEDUP_WINDOW_DAYS} days`,
        };
      }
    }

    return null;
  }

  async existsByLegacyId(jobID: string): Promise<boolean> {
    const id = String(jobID || '').trim();
    if (!id) return false;
    return Boolean(await this.findByLegacyId(id));
  }

  private async findByLegacyId(
    legacyId: string,
  ): Promise<{ id: string } | null> {
    // Prisma Mongo JsonFilter does not support `path` (Postgres-only). Use findRaw.
    const filter = {
      'metadata.legacyId': legacyId,
    } as Prisma.InputJsonValue;
    const options = {
      projection: { _id: 1 },
      limit: 1,
    } as Prisma.InputJsonValue;

    const [tempRaw, jobRaw] = await Promise.all([
      this.prisma.tempJob.findRaw({ filter, options }),
      this.prisma.job.findRaw({ filter, options }),
    ]);

    return pickRawId(tempRaw) ?? pickRawId(jobRaw);
  }

  private async findByApplyLink(
    applyLink: string,
    cutoff: Date,
  ): Promise<{ id: string } | null> {
    const where = {
      applyLink,
      createdAt: { gte: cutoff },
    };
    const [temp, job] = await Promise.all([
      this.prisma.tempJob.findFirst({
        where,
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.job.findFirst({
        where,
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return temp ?? job;
  }

  private async findByCompanyTitleExact(
    companyName: string,
    title: string,
    cutoff: Date,
  ): Promise<{ id: string } | null> {
    if (!companyName || !title) return null;
    const where = {
      companyName,
      title,
      createdAt: { gte: cutoff },
    };
    const [temp, job] = await Promise.all([
      this.prisma.tempJob.findFirst({
        where,
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.job.findFirst({
        where,
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return temp ?? job;
  }

  private async findByCompanyTitle(
    companyKey: string,
    titleKey: string,
    cutoff: Date,
  ): Promise<{ id: string } | null> {
    const companyPattern = identityRegexPattern(companyKey);
    const titlePattern = identityRegexPattern(titleKey);
    if (!companyPattern || !titlePattern) return null;
    const createdAt = toMongoDate(cutoff);
    const match = {
      ...(createdAt ? { createdAt: { $gte: createdAt } } : {}),
      companyName: { $regex: companyPattern, $options: 'i' },
      title: { $regex: titlePattern, $options: 'i' },
    };

    const [tempRaw, jobRaw] = await Promise.all([
      this.prisma.tempJob.findRaw({
        filter: match as Prisma.InputJsonValue,
        options: {
          projection: { _id: 1, companyName: 1, title: 1 },
          sort: { createdAt: -1 },
          limit: 8,
        } as Prisma.InputJsonValue,
      }),
      this.prisma.job.findRaw({
        filter: match as Prisma.InputJsonValue,
        options: {
          projection: { _id: 1, companyName: 1, title: 1 },
          sort: { createdAt: -1 },
          limit: 8,
        } as Prisma.InputJsonValue,
      }),
    ]);

    const hit =
      pickIdentityHit(tempRaw, companyKey, titleKey) ??
      pickIdentityHit(jobRaw, companyKey, titleKey);
    return hit;
  }
}
