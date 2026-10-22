import type { VendorTask } from '@prisma/client';
import {
  REVIEW_STATUSES,
  type BidUiStatus,
  type ReviewStatus,
} from '../constants/bid-status.constants';

export function deriveBidUiStatus(task: {
  reviewStatus?: string | null;
  status?: string | null;
  progress?: string | null;
  bidderInProcess?: boolean | null;
}): BidUiStatus {
  const review = String(task.reviewStatus || '').trim();
  if ((REVIEW_STATUSES as readonly string[]).includes(review)) {
    return review as ReviewStatus;
  }
  if (task.progress === 'skipped' || task.status === 'skipped')
    return 'skipped';
  if (task.progress === 'completed' || task.status === 'done')
    return 'submitted';
  if (task.bidderInProcess) return 'in_process';
  return 'pending';
}

export function deriveProgress(doc: {
  status?: string | null;
  recordingPath?: string | null;
  bidderInProcess?: boolean | null;
}): 'idle' | 'completed' | 'skipped' | 'active' {
  if (doc.status === 'done' || doc.recordingPath) return 'completed';
  if (doc.status === 'skipped') return 'skipped';
  if (doc.bidderInProcess) return 'active';
  return 'idle';
}
