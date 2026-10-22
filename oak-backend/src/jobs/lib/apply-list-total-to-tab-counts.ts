import type { JobStatusTab } from '../constants/job-list.constants';
import { JOB_STATUS_STATES } from '../constants/job-status-states.constants';

const TRACKED_TABS = JOB_STATUS_STATES.filter((state) => state !== 'posted');

function trackedSum(counts: Record<JobStatusTab, number>): number {
  return TRACKED_TABS.reduce((sum, state) => sum + (counts[state] ?? 0), 0);
}

/**
 * Pin the active tab to the filtered list total, then keep All/New consistent
 * with tracked badges. Status-scoped lists are already New/Applied/etc. — do
 * not subtract tracked from that total again.
 */
export function applyListTotalToTabCounts(
  counts: Record<JobStatusTab, number>,
  status: JobStatusTab,
  listJobTotal: number,
): Record<JobStatusTab, number> {
  const next = { ...counts };
  if (status === 'all') {
    next.all = listJobTotal;
    next.posted = Math.max(0, listJobTotal - trackedSum(next));
    return next;
  }
  next[status] = listJobTotal;
  next.all = next.posted + trackedSum(next);
  return next;
}
