import { BID_RESULT_ID_PREFIX } from '../constants/bid-status.constants';
import { dayKeyFromIso, initials } from '../lib/day-key';
import { deriveBidUiStatus } from './bid-ui-status';

function unwrapFlag(
  flags: Record<string, unknown> | null | undefined,
  key: string,
): 'green' | 'red' | null {
  if (!flags || typeof flags !== 'object') return null;
  const raw = flags[key];
  if (typeof raw === 'string') {
    if (raw === 'green' || raw === 'red') return raw;
    return null;
  }
  if (raw && typeof raw === 'object') {
    const status = (raw as { status?: string }).status;
    if (status === 'green' || status === 'red') return status;
  }
  return null;
}

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

/** Map serialized vendor task → Bid Management BidResult row. */
export function mapTaskToBidResult(
  task: Record<string, unknown>,
): Record<string, unknown> {
  const uiStatus = deriveBidUiStatus({
    reviewStatus: task.reviewStatus as string | null,
    status: task.status as string | null,
    progress: task.progress as string | null,
    bidderInProcess: Boolean(task.bidderInProcess),
  });

  const bidReadyDate =
    (task.bidReadyDate as string | null) || (task.addedAt as string | null);
  const pooledAt = bidReadyDate || new Date().toISOString();
  const completedAt = task.completedAt as string | null;
  const updatedAt = task.updatedAt as string | null;
  const submittedAt =
    uiStatus === 'pending' || uiStatus === 'in_process'
      ? null
      : completedAt || updatedAt;

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
      usedAt: task.recommendedAt ?? null,
      scorePercent: null,
    };
  } else if (useCustomized) {
    recommendedResume = {
      name: 'Use customized resume',
      techStack: null,
      source: 'Library recommend',
      fileName: null,
      usedAt: task.recommendedAt ?? null,
      scorePercent: null,
    };
  }

  const recording = task.recording as {
    storagePath?: string;
    contentType?: string;
    sizeBytes?: number;
  } | null;

  const bidderName =
    (task.bidderName as string | null) ||
    (task.applierName as string | null) ||
    null;

  const flags = (task.flags as Record<string, unknown> | null) ?? null;

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
    submittedAt,
    durationSec: task.recordingDurationSec ?? null,
    biddingDurationSec: task.biddingDurationSec ?? null,
    matchScore: task.matchScore ?? null,
    flags: {
      remote: unwrapFlag(flags, 'remote'),
      clearance: unwrapFlag(flags, 'clearance'),
    },
    analysisSummary: task.analysisSummary ?? null,
    analysisFormAnswers: task.analysisFormAnswers ?? [],
    analysisMode: task.analysisMode ?? null,
    analysisPageUrl: task.analysisPageUrl ?? null,
    analysisPageTitle: task.analysisPageTitle ?? null,
    analysisUsage: task.analysisUsage ?? null,
    analysisRequestId: task.analysisRequestId ?? null,
    analyzedAt: task.analyzedAt ?? null,
    flagAnalysisMode: task.flagAnalysisMode ?? null,
    flagAnalysisUsage: task.flagAnalysisUsage ?? null,
    flagAnalysisRequestId: task.flagAnalysisRequestId ?? null,
    flagAnalyzedAt: task.flagAnalyzedAt ?? null,
    jobDetail: null,
    recommendedResume,
    submissionResume: null,
    recommendedResumeStack: stack,
    recommendedResumeId: task.recommendedResumeId ?? null,
    recommendedResumeReason: task.recommendedResumeReason ?? null,
    useCustomizedResume: useCustomized,
    recommendWarning: task.recommendWarning ?? null,
    recommendedAt: task.recommendedAt ?? null,
    recommendMode: task.recommendMode ?? null,
    recommendUsage: task.recommendUsage ?? null,
    recommendRequestId: task.recommendRequestId ?? null,
    resumeStackMatch: task.resumeStackMatch ?? null,
    recording: recording?.storagePath
      ? {
          storagePath: recording.storagePath,
          contentType: recording.contentType || 'video/webm',
          sizeBytes: Number(recording.sizeBytes || 0),
          previewUrl: null,
        }
      : null,
    recordings: Array.isArray(task.recordings) ? task.recordings : [],
    resumeAudits: Array.isArray(task.resumeAudits) ? task.resumeAudits : [],
    notes: notesForStatus(uiStatus),
    sessionId: recording?.storagePath
      ? ((task.recording as { sessionId?: string | null })?.sessionId ?? null)
      : null,
    skipReason: task.skipReason ?? null,
    rejectReason: task.rejectReason ?? null,
    rejectSource: task.rejectSource ?? null,
    rejectCount: Number(task.rejectCount || 0),
    resubmitCount: Number(task.resubmitCount || 0),
    lastRejectedAt: task.lastRejectedAt ?? null,
    lastResubmittedAt: task.lastResubmittedAt ?? null,
    resumeOriginalName: task.resumeOriginalName ?? null,
    resumeExpectedName: task.resumeExpectedName ?? null,
    resumeCleanedName: task.resumeCleanedName ?? null,
    resumeRenamed: Boolean(task.resumeRenamed),
    resumeMismatch: Boolean(task.resumeMismatch),
  };
}

export function stripBidResultIdPrefix(id: string): string {
  const raw = String(id || '').trim();
  if (raw.startsWith(BID_RESULT_ID_PREFIX)) {
    return raw.slice(BID_RESULT_ID_PREFIX.length);
  }
  return raw;
}
