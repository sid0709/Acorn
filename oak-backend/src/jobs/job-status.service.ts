import { Injectable } from '@nestjs/common';
import { asObjectIdHex, mongoFieldIdIn } from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMPTY_STATUS_COUNTS,
  type JobStatusTab,
} from './constants/job-list.constants';
import {
  JOB_STATUS_STATES,
  type JobStatusState,
} from './constants/job-status-states.constants';
import type { ListJobsQueryDto } from './dto/list-jobs.query.dto';
import {
  extractFirstBatch,
  jobsAggregateCommand,
  jobsFilteredCountPipeline,
  jobsMatchingIdsPipeline,
} from './lib/jobs-list-pipelines';
import { buildJobsMongoMatch } from './lib/jobs-mongo-match';

const TRACKED_TABS = JOB_STATUS_STATES.filter(
  (state): state is Exclude<JobStatusState, 'posted'> => state !== 'posted',
);

@Injectable()
export class JobStatusService {
  constructor(private readonly prisma: PrismaService) {}

  /** States for one profile across a page of job ids. */
  async statesForJobs(
    profileId: string,
    jobIds: string[],
  ): Promise<Map<string, string>> {
    const id = String(profileId || '').trim();
    const ids = [
      ...new Set(jobIds.map((j) => String(j || '').trim()).filter(Boolean)),
    ];
    const out = new Map<string, string>();
    if (!id || !ids.length) return out;

    const rows = await this.prisma.jobStatus.findMany({
      where: { profileId: id, jobId: { in: ids } },
      select: { jobId: true, state: true },
    });
    for (const row of rows) out.set(row.jobId, row.state);
    return out;
  }

  /** Status-tab badges from `job_statuses` (no denormalized counter collection). */
  async tabCounts(
    profileId: string,
    catalogTotal = 0,
  ): Promise<Record<JobStatusTab, number>> {
    const counts: Record<JobStatusTab, number> = {
      ...EMPTY_STATUS_COUNTS,
      all: catalogTotal,
    };
    const id = String(profileId || '').trim();
    if (!id) return counts;

    const groups = await this.prisma.jobStatus.groupBy({
      by: ['state'],
      where: { profileId: id },
      _count: { _all: true },
    });

    let tracked = 0;
    for (const group of groups) {
      const state = group.state as JobStatusState;
      if (!(TRACKED_TABS as readonly string[]).includes(state)) continue;
      const n = group._count._all;
      counts[state] = n;
      tracked += n;
    }
    counts.posted = Math.max(0, catalogTotal - tracked);
    return counts;
  }

  /**
   * Status-tab badges scoped to the same Mongo `$match` as the filtered list
   * (source, posted date, title/company query, etc.). Independent of the
   * active status tab. Pass `allTotal` when the list query already counted
   * matching jobs.
   */
  async filteredTabCounts(
    profileId: string,
    query: ListJobsQueryDto,
    opts?: { allTotal?: number },
  ): Promise<Record<JobStatusTab, number>> {
    const counts: Record<JobStatusTab, number> = { ...EMPTY_STATUS_COUNTS };
    const id = String(profileId || '').trim();
    const all =
      opts?.allTotal !== undefined
        ? opts.allTotal
        : await this.countMatchingJobs(query);
    counts.all = all;
    if (!id) {
      counts.posted = all;
      return counts;
    }
    if (opts?.allTotal === undefined && all === 0) {
      counts.posted = 0;
      return counts;
    }

    const statusRows = await this.prisma.jobStatus.findMany({
      where: { profileId: id, state: { in: [...TRACKED_TABS] } },
      select: { jobId: true, state: true },
    });
    if (!statusRows.length) {
      counts.posted = all;
      return counts;
    }

    const trackedIds = [...new Set(statusRows.map((row) => row.jobId))];
    const matchingSet = await this.matchingTrackedJobIds(query, trackedIds);

    let tracked = 0;
    for (const row of statusRows) {
      const jobId = (asObjectIdHex(row.jobId) || row.jobId).toLowerCase();
      if (!matchingSet.has(jobId)) continue;
      const state = row.state as JobStatusState;
      if (!(TRACKED_TABS as readonly string[]).includes(state)) continue;
      counts[state] += 1;
      tracked += 1;
    }
    counts.posted = Math.max(0, all - tracked);
    return counts;
  }

  private async countMatchingJobs(query: ListJobsQueryDto): Promise<number> {
    const raw = await this.prisma.$runCommandRaw(
      jobsAggregateCommand(
        jobsFilteredCountPipeline(buildJobsMongoMatch(query)),
      ),
    );
    const row = extractFirstBatch(raw)[0];
    if (!row || typeof row !== 'object') return 0;
    return Number((row as { jobs?: number }).jobs || 0);
  }

  private async matchingTrackedJobIds(
    query: ListJobsQueryDto,
    trackedIds: string[],
  ): Promise<Set<string>> {
    const out = new Set<string>();
    if (!trackedIds.length) return out;
    const match = {
      ...buildJobsMongoMatch(query),
      ...(mongoFieldIdIn('_id', trackedIds) as Record<string, unknown>),
    };
    const raw = await this.prisma.$runCommandRaw(
      jobsAggregateCommand(jobsMatchingIdsPipeline(match)),
    );
    for (const row of extractFirstBatch(raw)) {
      if (!row || typeof row !== 'object') continue;
      const id = asObjectIdHex((row as { _id?: unknown })._id);
      if (id) out.add(id.toLowerCase());
    }
    return out;
  }

  /** Job ids currently in a non-posted pipeline state for this profile. */
  async jobIdsForState(profileId: string, state: string): Promise<string[]> {
    const id = String(profileId || '').trim();
    const status = String(state || '').trim();
    if (!id || !status || status === 'posted' || status === 'all') return [];

    const rows = await this.prisma.jobStatus.findMany({
      where: { profileId: id, state: status },
      select: { jobId: true },
    });
    return rows.map((row) => row.jobId);
  }

  /** Job ids that have any `job_statuses` row (i.e. not New/posted). */
  async jobIdsWithAnyStatus(profileId: string): Promise<string[]> {
    const id = String(profileId || '').trim();
    if (!id) return [];

    const rows = await this.prisma.jobStatus.findMany({
      where: {
        profileId: id,
        state: { in: [...TRACKED_TABS] },
      },
      select: { jobId: true },
    });
    return rows.map((row) => row.jobId);
  }

  /**
   * Apply mutations key `job_statuses` by AccountInfo.name. Prefer that id
   * over a client-supplied profileId so New-tab excludes match writes.
   */
  async resolveProfileId(
    profileId: string,
    applierName: string,
  ): Promise<string> {
    const name = String(applierName || '').trim();
    if (name) {
      const account = await this.prisma.accountInfo.findUnique({
        where: { name },
        select: { id: true },
      });
      if (account?.id) return account.id;
    }
    return String(profileId || '').trim();
  }
}
