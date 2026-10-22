import type { Job, VendorTask } from '@prisma/client';
import { inferJobSource } from '../../jobs/lib/infer-job-source';
import { normalizeJobMetadata } from '../../jobs/mappers/job-metadata.mapper';
import type { PrismaService } from '../../prisma/prisma.service';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

/** Denormalized Job fields copied onto vendor_tasks for Bid Management cards. */
export type JobIdentitySnapshot = {
  title: string;
  company: string;
  applyUrl: string | null;
  source: string;
  location: string;
  workMode: string;
};

export type ResolvedJobIdentity = {
  snapshot: JobIdentitySnapshot;
  bidReadyDate: Date | null;
};

export function jobIdentitySnapshot(job: Job): JobIdentitySnapshot {
  const meta = normalizeJobMetadata(job.metadata) ?? {};
  const applyUrl = job.applyLink ?? null;
  return {
    title: String(job.title || '').trim() || 'Untitled role',
    company: String(job.companyName || '').trim(),
    applyUrl,
    source: job.source || inferJobSource(applyUrl),
    location: meta.details?.location ?? '',
    workMode: meta.details?.remote ?? '',
  };
}

export function isBlankTitle(value: unknown): boolean {
  const title = String(value ?? '').trim();
  return !title || title === 'Untitled role';
}

export function isBlankCompany(value: unknown): boolean {
  return !String(value ?? '').trim();
}

/** True when a vendor_tasks row would render as Untitled / Unknown. */
export function needsJobIdentityBackfill(row: {
  title?: unknown;
  company?: unknown;
}): boolean {
  return isBlankTitle(row.title) || isBlankCompany(row.company);
}

/** Load Job (+ JobStatus.bidReadyAt) for recommend/create paths that omit card fields. */
export async function resolveJobIdentity(
  prisma: PrismaService,
  applierName: string,
  jobId: string,
): Promise<ResolvedJobIdentity | null> {
  if (!OBJECT_ID_RE.test(jobId)) return null;
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;

  let bidReadyDate: Date | null = null;
  const account = await prisma.accountInfo.findUnique({
    where: { name: applierName },
    select: { id: true },
  });
  if (account) {
    const status = await prisma.jobStatus.findUnique({
      where: {
        profileId_jobId: { profileId: account.id, jobId },
      },
      select: { bidReadyAt: true },
    });
    bidReadyDate = status?.bidReadyAt ?? null;
  }

  return { snapshot: jobIdentitySnapshot(job), bidReadyDate };
}

/** Fill blank Untitled/Unknown identity (and missing bidReadyDate) from Job. */
export function mergeMissingJobIdentity(
  target: Record<string, unknown>,
  identity: ResolvedJobIdentity | null,
  existing: VendorTask | null,
): void {
  if (!identity) return;
  const { snapshot, bidReadyDate } = identity;

  if (isBlankTitle(target.title) && isBlankTitle(existing?.title)) {
    target.title = snapshot.title;
  }
  if (isBlankCompany(target.company) && isBlankCompany(existing?.company)) {
    target.company = snapshot.company;
  }
  if (
    target.applyUrl === undefined &&
    !existing?.applyUrl &&
    snapshot.applyUrl
  ) {
    target.applyUrl = snapshot.applyUrl;
  }
  if (
    !String(target.source ?? existing?.source ?? '').trim() &&
    snapshot.source
  ) {
    target.source = snapshot.source;
  }
  if (
    !String(target.location ?? existing?.location ?? '').trim() &&
    snapshot.location
  ) {
    target.location = snapshot.location;
  }
  if (
    !String(target.workMode ?? existing?.workMode ?? '').trim() &&
    snapshot.workMode
  ) {
    target.workMode = snapshot.workMode;
  }
  if (
    target.bidReadyDate === undefined &&
    !existing?.bidReadyDate &&
    bidReadyDate
  ) {
    target.bidReadyDate = bidReadyDate;
  }
}
