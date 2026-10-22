import { COMPANY_MEMBERS_PAGE_SIZE } from '../constants/job-list.constants';
import { mapJobToListDoc } from './job-list.mapper';
import type { JobListRow } from '../constants/job-list.select';

export type CompanyGroupSource = {
  companyId: string;
  companyName: string;
  companyLogo?: string | null;
  companyUrl?: string | null;
  matchingJobCount: number;
  /** Newest-first ids used to hydrate this page (≤ COMPANY_MEMBERS_PAGE_SIZE). */
  matchingJobIds: string[];
};

/** Order hydrated jobs by the company's matchingJobIds sequence. */
export function orderJobsByIds(
  jobs: JobListRow[],
  orderedIds: string[],
): JobListRow[] {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const ordered: JobListRow[] = [];
  for (const id of orderedIds) {
    const job = byId.get(id);
    if (job) ordered.push(job);
  }
  return ordered;
}

export function mapCompanyGroupRow(
  group: CompanyGroupSource,
  jobs: JobListRow[],
  stateByJobId: Map<string, string>,
): Record<string, unknown> {
  const memberIds = group.matchingJobIds.slice(0, COMPANY_MEMBERS_PAGE_SIZE);
  const ordered = orderJobsByIds(jobs, memberIds);
  const logo =
    typeof group.companyLogo === 'string' && group.companyLogo.trim()
      ? group.companyLogo.trim()
      : undefined;
  const url =
    typeof group.companyUrl === 'string' && group.companyUrl.trim()
      ? group.companyUrl.trim()
      : undefined;

  return {
    companyId: group.companyId,
    company: {
      name: group.companyName,
      ...(logo ? { logo } : {}),
      ...(url ? { url } : {}),
    },
    jobs: ordered.map((job) =>
      mapJobToListDoc(job, stateByJobId.get(job.id) || 'posted'),
    ),
    matchingJobCount: group.matchingJobCount,
    matchingJobIds: memberIds,
    nextMemberOffset:
      group.matchingJobCount > ordered.length ? ordered.length : null,
  };
}
