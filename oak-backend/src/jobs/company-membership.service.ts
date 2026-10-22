import { Injectable } from '@nestjs/common';
import {
  rawDeleteMany,
  rawInsertOne,
  rawUpdateMany,
  withReplicaSetFallback,
} from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeCompanyKey } from './lib/company-key';
import {
  attachToSourceBuckets,
  cloneSourceBuckets,
  removeFromSourceBuckets,
  type SourceBucket,
} from './lib/company-source-buckets';
import {
  refreshSourceBucketHeads,
  saveCompanyMembership,
} from './lib/company-membership-write';

const COMPANIES_COLLECTION = 'companies';

export type CompanyProfileInput = {
  companyName: string;
  companyUrl?: string | null;
  companyLogo?: string | null;
};

export type CompanyMembershipInput = CompanyProfileInput & {
  jobId: string;
  postedAt: Date;
  source: string;
};

function asOptionalUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Prefer existing non-empty value; fill from incoming only when existing is missing.
 * Never replace a known companyUrl/companyLogo with null/empty.
 */
export function preferExistingText(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  return asOptionalUrl(existing) ?? asOptionalUrl(incoming);
}

function asSourceBuckets(
  buckets: SourceBucket[] | null | undefined,
): SourceBucket[] {
  return cloneSourceBuckets(buckets);
}

/**
 * Upserts Company rows for Job Search grouping.
 *
 * Merge policy for companyUrl / companyLogo:
 * - existing missing + incoming present → fill
 * - existing present + incoming missing → keep existing
 * - both present → keep existing (do not overwrite)
 */
@Injectable()
export class CompanyMembershipService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create company if missing, or fill null URL/logo from temp job.
   * Does not touch jobIds — call {@link attachJob} after the Job row exists.
   */
  async upsertProfile(input: CompanyProfileInput): Promise<string> {
    const companyKey = normalizeCompanyKey(input.companyName);
    if (!companyKey) {
      throw new Error('companyName is required for company membership');
    }

    const displayName = String(input.companyName || '').trim() || companyKey;
    const incomingUrl = asOptionalUrl(input.companyUrl);
    const incomingLogo = asOptionalUrl(input.companyLogo);

    const existing = await this.prisma.company.findUnique({
      where: { companyKey },
    });

    if (!existing) {
      const now = new Date();
      return withReplicaSetFallback(
        async () => {
          const created = await this.prisma.company.create({
            data: {
              companyKey,
              companyName: displayName,
              companyUrl: incomingUrl,
              companyLogo: incomingLogo,
              jobIds: [],
              lastPostedAt: new Date(0),
              jobCount: 0,
              sourceBuckets: [],
            },
          });
          return created.id;
        },
        async () => {
          await rawInsertOne(this.prisma, COMPANIES_COLLECTION, {
            companyKey,
            companyName: displayName,
            companyUrl: incomingUrl,
            companyLogo: incomingLogo,
            jobIds: [],
            lastPostedAt: new Date(0),
            jobCount: 0,
            sourceBuckets: [],
            createdAt: now,
            updatedAt: now,
          });
          const created = await this.prisma.company.findUnique({
            where: { companyKey },
          });
          if (!created) {
            throw new Error(`company insert failed for key ${companyKey}`);
          }
          return created.id;
        },
      );
    }

    const companyUrl = preferExistingText(existing.companyUrl, incomingUrl);
    const companyLogo = preferExistingText(existing.companyLogo, incomingLogo);
    const companyName = existing.companyName?.trim() || displayName;

    const urlChanged = companyUrl !== asOptionalUrl(existing.companyUrl);
    const logoChanged = companyLogo !== asOptionalUrl(existing.companyLogo);
    const nameChanged = companyName !== existing.companyName;

    if (urlChanged || logoChanged || nameChanged) {
      await withReplicaSetFallback(
        () =>
          this.prisma.company.update({
            where: { id: existing.id },
            data: { companyUrl, companyLogo, companyName },
          }),
        async () => {
          await rawUpdateMany(
            this.prisma,
            COMPANIES_COLLECTION,
            { _id: { $oid: existing.id } },
            { companyUrl, companyLogo, companyName, updatedAt: new Date() },
          );
          return null;
        },
      );
    }

    return existing.id;
  }

  /** Prepend job id (newest-first) after the Job catalog row is created. */
  async attachJob(input: {
    companyId: string;
    jobId: string;
    postedAt: Date;
    source: string;
  }): Promise<void> {
    const existing = await this.prisma.company.findUnique({
      where: { id: input.companyId },
    });
    if (!existing) {
      throw new Error(`company not found: ${input.companyId}`);
    }

    const jobIds = [
      input.jobId,
      ...existing.jobIds.filter((id) => id !== input.jobId),
    ];
    const lastPostedAt =
      input.postedAt > existing.lastPostedAt
        ? input.postedAt
        : existing.lastPostedAt;
    const sourceBuckets = attachToSourceBuckets(
      asSourceBuckets(existing.sourceBuckets),
      input,
    );
    await saveCompanyMembership(this.prisma, existing.id, {
      jobIds,
      lastPostedAt,
      sourceBuckets,
    });
  }

  /** Upsert profile then attach job id (used by register / promote). */
  async ensureMembership(input: CompanyMembershipInput): Promise<string> {
    const companyId = await this.upsertProfile(input);
    await this.attachJob({
      companyId,
      jobId: input.jobId,
      postedAt: input.postedAt,
      source: input.source,
    });
    return companyId;
  }

  /** Remove job ids from company membership; delete empty company rows. */
  async detachJobs(
    jobs: Array<{ id: string; companyId: string | null; source?: string }>,
  ): Promise<void> {
    const byCompany = new Map<string, string[]>();
    for (const job of jobs) {
      const companyId = String(job.companyId || '').trim();
      if (!companyId) continue;
      const list = byCompany.get(companyId) || [];
      list.push(job.id);
      byCompany.set(companyId, list);
    }

    for (const [companyId, removeIds] of byCompany) {
      const existing = await this.prisma.company.findUnique({
        where: { id: companyId },
      });
      if (!existing) continue;
      const removeSet = new Set(removeIds);
      const jobIds = existing.jobIds.filter((id) => !removeSet.has(id));
      if (jobIds.length === 0) {
        await withReplicaSetFallback(
          () => this.prisma.company.delete({ where: { id: companyId } }),
          async () => {
            await rawDeleteMany(this.prisma, COMPANIES_COLLECTION, {
              _id: { $oid: companyId },
            });
            return null;
          },
        );
        continue;
      }
      const removed = removeFromSourceBuckets(
        asSourceBuckets(existing.sourceBuckets),
        removeSet,
      );
      const sourceBuckets = await refreshSourceBucketHeads(
        this.prisma,
        removed,
      );
      await saveCompanyMembership(this.prisma, companyId, {
        jobIds,
        sourceBuckets,
      });
    }
  }
}
