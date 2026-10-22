import type { Job, TempJob } from '@prisma/client';
import {
  normalizeJobMetadata,
  type JobMetadataCapsule,
} from './job-metadata.mapper';

type JobListSource = Pick<
  Job | TempJob,
  | 'id'
  | 'title'
  | 'companyName'
  | 'source'
  | 'postedAt'
  | 'applyLink'
  | 'companyLink'
  | 'aiSkills'
  | 'aiSkillStatus'
  | 'sourceCatalog'
  | 'metadata'
> & {
  description?: string | null;
  companyId?: string | null;
};

/** Map Prisma Job (list or detail) → shape expected by Athens `mapDocToJob`. */
export function mapJobToListDoc(
  job: JobListSource,
  viewerStatus = 'posted',
): Record<string, unknown> {
  const metadata: JobMetadataCapsule = normalizeJobMetadata(job.metadata) ?? {};
  const logo =
    typeof metadata.companyLogo === 'string' ? metadata.companyLogo.trim() : '';
  const description =
    'description' in job && typeof job.description === 'string'
      ? job.description
      : undefined;
  const companyId =
    typeof job.companyId === 'string' && job.companyId.trim()
      ? job.companyId.trim()
      : undefined;

  return {
    _id: job.id,
    title: job.title,
    companyName: job.companyName,
    ...(companyId ? { companyId } : {}),
    company: {
      name: job.companyName,
      ...(logo ? { logo } : {}),
      ...(job.companyLink ? { url: job.companyLink } : {}),
    },
    source: job.source,
    postedAt: job.postedAt.toISOString(),
    applyLink: job.applyLink ?? undefined,
    companyLink: job.companyLink ?? undefined,
    ...(description ? { description } : {}),
    aiSkills: job.aiSkills ?? undefined,
    aiSkillStatus: job.aiSkillStatus ?? undefined,
    details: metadata.details ?? undefined,
    catalog: job.sourceCatalog === 'external' ? 'external' : 'market',
    viewerStatus,
  };
}
