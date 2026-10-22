import type { PrismaClient } from '@prisma/client';
import {
  rawUpdateMany,
  withReplicaSetFallback,
} from '../../prisma/mongo-standalone';
import {
  applyHeadPostedAt,
  toMongoSourceBuckets,
  type SourceBucket,
} from './company-source-buckets';

const COMPANIES_COLLECTION = 'companies';

export type CompanyMembershipWrite = {
  jobIds: string[];
  lastPostedAt?: Date;
  sourceBuckets: SourceBucket[];
};

export async function refreshSourceBucketHeads(
  prisma: PrismaClient,
  removed: { buckets: SourceBucket[]; headsNeedingPostedAt: string[] },
): Promise<SourceBucket[]> {
  if (!removed.headsNeedingPostedAt.length) return removed.buckets;
  const heads = await prisma.job.findMany({
    where: { id: { in: removed.headsNeedingPostedAt } },
    select: { id: true, postedAt: true },
  });
  return applyHeadPostedAt(
    removed.buckets,
    new Map(heads.map((row) => [row.id, row.postedAt])),
  );
}

export async function saveCompanyMembership(
  prisma: PrismaClient,
  id: string,
  data: CompanyMembershipWrite,
): Promise<void> {
  const payload = {
    jobIds: data.jobIds,
    jobCount: data.jobIds.length,
    sourceBuckets: data.sourceBuckets,
    ...(data.lastPostedAt ? { lastPostedAt: data.lastPostedAt } : {}),
  };
  await withReplicaSetFallback(
    () =>
      prisma.company.update({
        where: { id },
        data: payload,
      }),
    async () => {
      await rawUpdateMany(
        prisma,
        COMPANIES_COLLECTION,
        { _id: { $oid: id } },
        {
          jobIds: data.jobIds.map((jobId) => ({ $oid: jobId })),
          jobCount: data.jobIds.length,
          sourceBuckets: toMongoSourceBuckets(data.sourceBuckets),
          ...(data.lastPostedAt ? { lastPostedAt: data.lastPostedAt } : {}),
          updatedAt: new Date(),
        },
      );
      return null;
    },
  );
}
