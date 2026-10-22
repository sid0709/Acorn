import { BID_RESULT_ID_PREFIX } from '../constants/bid-status.constants';
import { dayKeyFromIso, initials } from '../lib/day-key';
import { isoOrNull } from '../lib/iso';
import { deriveBidUiStatus } from './bid-ui-status';

/** Board/KPI fields only — skip analysis JSON, recordings arrays, and audits. */
export const BID_BOARD_SELECT = {
  id: true,
  jobId: true,
  title: true,
  company: true,
  applyUrl: true,
  source: true,
  location: true,
  status: true,
  reviewStatus: true,
  bidderInProcess: true,
  bidderName: true,
  applierName: true,
  addedAt: true,
  completedAt: true,
  updatedAt: true,
  bidReadyDate: true,
  biddingDurationSec: true,
  matchScore: true,
  recordingDurationSec: true,
  recordingPath: true,
  recordingContentType: true,
  recordingSize: true,
  skipReason: true,
  rejectReason: true,
  rejectSource: true,
  rejectCount: true,
  resubmitCount: true,
  resumeOriginalName: true,
  resumeExpectedName: true,
  resumeCleanedName: true,
  resumeRenamed: true,
  resumeMismatch: true,
  resumeStackMatch: true,
  analysisPageUrl: true,
  recommendedResumeStack: true,
  useCustomizedResume: true,
  recommendedAt: true,
} as const;

export type BidBoardTask = {
  id: string;
  jobId: string;
  title: string;
  company: string;
  applyUrl: string | null;
  source: string;
  location: string;
  status: string;
  reviewStatus: string | null;
  bidderInProcess: boolean;
  bidderName: string | null;
  applierName: string;
  addedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
  bidReadyDate: Date | null;
  biddingDurationSec: number | null;
  matchScore: number | null;
  recordingDurationSec: number | null;
  recordingPath: string | null;
  recordingContentType: string | null;
  recordingSize: number | null;
  skipReason: string | null;
  rejectReason: string | null;
  rejectSource: string | null;
  rejectCount: number;
  resubmitCount: number;
  resumeOriginalName: string | null;
  resumeExpectedName: string | null;
  resumeCleanedName: string | null;
  resumeRenamed: boolean;
  resumeMismatch: boolean;
  resumeStackMatch: string | null;
  analysisPageUrl: string | null;
  recommendedResumeStack: string | null;
  useCustomizedResume: boolean;
  recommendedAt: Date | null;
};

function notesForStatus(status: string): string {
  switch (status) {
    case 'rejected':
      return 'Rejected — needs fix';
    case 'reviewed':
      return 'Reviewed';
    case 'submitted':
      return 'Submitted for review';
    case 'in_process':
      return 'Bidder in process';
    case 'skipped':
      return 'Skipped';
    default:
      return 'Pending bid';
  }
}

/** Same UI status as the download report (no recording `progress` overlay). */
export function mapVendorTaskToBoardResult(
  task: BidBoardTask,
): Record<string, unknown> {
  const uiStatus = deriveBidUiStatus({
    reviewStatus: task.reviewStatus,
    status: task.status,
    bidderInProcess: task.bidderInProcess,
  });
  const pooledAt =
    isoOrNull(task.bidReadyDate) ||
    isoOrNull(task.addedAt) ||
    new Date().toISOString();
  const completedAt = isoOrNull(task.completedAt);
  const updatedAt = isoOrNull(task.updatedAt);
  const bidderName = task.bidderName || task.applierName || null;
  const stack = task.recommendedResumeStack
    ? String(task.recommendedResumeStack)
    : null;
  const useCustomized = Boolean(task.useCustomizedResume);
  let recommendedResume: Record<string, unknown> | null = null;
  if (stack) {
    recommendedResume = {
      name: useCustomized ? 'Use customized resume' : `Recommended · ${stack}`,
      techStack: stack,
      source: 'Library recommend',
      fileName: null,
      usedAt: isoOrNull(task.recommendedAt),
      scorePercent: null,
    };
  } else if (useCustomized) {
    recommendedResume = {
      name: 'Use customized resume',
      techStack: null,
      source: 'Library recommend',
      fileName: null,
      usedAt: isoOrNull(task.recommendedAt),
      scorePercent: null,
    };
  }

  return {
    id: `${BID_RESULT_ID_PREFIX}${task.id}`,
    taskId: task.id,
    jobId: task.jobId ?? null,
    dayKey: dayKeyFromIso(pooledAt),
    job: {
      title: task.title || 'Untitled role',
      company: task.company || '',
      location: task.location || '',
      source: task.source || '',
      applyUrl: task.applyUrl ?? null,
    },
    bidder: {
      name: bidderName,
      avatarInitials: initials(bidderName),
    },
    status: uiStatus,
    pooledAt,
    submittedAt:
      uiStatus === 'pending' || uiStatus === 'in_process'
        ? null
        : completedAt || updatedAt,
    durationSec: task.recordingDurationSec ?? null,
    biddingDurationSec: task.biddingDurationSec ?? null,
    matchScore: task.matchScore ?? null,
    flags: { remote: null, clearance: null },
    analysisPageUrl: task.analysisPageUrl ?? null,
    jobDetail: null,
    recommendedResume,
    submissionResume: null,
    recommendedResumeStack: stack,
    useCustomizedResume: useCustomized,
    recommendedAt: isoOrNull(task.recommendedAt),
    resumeStackMatch: task.resumeStackMatch ?? null,
    recording: task.recordingPath
      ? {
          storagePath: task.recordingPath,
          contentType: task.recordingContentType || 'video/webm',
          sizeBytes: Number(task.recordingSize || 0),
          previewUrl: null,
        }
      : null,
    recordings: [],
    resumeAudits: [],
    notes: notesForStatus(uiStatus),
    skipReason: task.skipReason ?? null,
    rejectReason: task.rejectReason ?? null,
    rejectSource: task.rejectSource ?? null,
    rejectCount: Number(task.rejectCount || 0),
    resubmitCount: Number(task.resubmitCount || 0),
    resumeOriginalName: task.resumeOriginalName ?? null,
    resumeExpectedName: task.resumeExpectedName ?? null,
    resumeCleanedName: task.resumeCleanedName ?? null,
    resumeRenamed: Boolean(task.resumeRenamed),
    resumeMismatch: Boolean(task.resumeMismatch),
  };
}
