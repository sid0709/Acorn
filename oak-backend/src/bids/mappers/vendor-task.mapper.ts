import type { VendorTask } from '@prisma/client';
import { inferJobSource } from '../../jobs/lib/infer-job-source';
import { VENDOR_TASK_STATUSES } from '../constants/bid-status.constants';
import { isoOrNull } from '../lib/iso';
import { deriveProgress } from './bid-ui-status';

type RecordingEntry = {
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  sessionId: string | null;
  durationSec: number | null;
  recordedStartAt: string | null;
  recordedEndAt: string | null;
  uploadedAt: string | null;
};

type ResumeAuditEntry = {
  originalName: string;
  expectedName: string | null;
  cleanedName: string | null;
  renamed: boolean;
  mismatch: boolean;
  sessionId: string | null;
  source: string | null;
  fileSize: number | null;
  mimeType: string | null;
  auditKey: string | null;
  recordedAt: string | null;
};

function normalizeRecordings(
  doc: VendorTask,
  primary: RecordingEntry | null,
): RecordingEntry[] {
  const fromArray = Array.isArray(doc.recordings)
    ? (doc.recordings as unknown[])
        .map((entry) => {
          const row = entry as Record<string, unknown>;
          const storagePath = String(row?.storagePath || '').trim();
          if (!storagePath) return null;
          return {
            storagePath,
            contentType: String(row.contentType || 'video/webm'),
            sizeBytes: Number(row.sizeBytes || 0) || 0,
            sessionId: row.sessionId ? String(row.sessionId) : null,
            durationSec:
              typeof row.durationSec === 'number' ? row.durationSec : null,
            recordedStartAt: isoOrNull(row.recordedStartAt as string | null),
            recordedEndAt: isoOrNull(row.recordedEndAt as string | null),
            uploadedAt: isoOrNull(row.uploadedAt as string | null),
          } satisfies RecordingEntry;
        })
        .filter((x): x is RecordingEntry => Boolean(x))
    : [];
  if (fromArray.length > 0) return fromArray;
  if (primary?.storagePath) {
    return [
      {
        ...primary,
        durationSec:
          typeof doc.recordingDurationSec === 'number'
            ? doc.recordingDurationSec
            : null,
        recordedStartAt: isoOrNull(doc.recordingStartedAt),
        recordedEndAt: isoOrNull(doc.recordingEndedAt),
        uploadedAt: null,
      },
    ];
  }
  return [];
}

function normalizeResumeAudits(doc: VendorTask): ResumeAuditEntry[] {
  const fromArray = Array.isArray(doc.resumeAudits)
    ? (doc.resumeAudits as unknown[])
        .map((entry) => {
          const row = entry as Record<string, unknown>;
          const originalName = String(row?.originalName || '').trim();
          if (!originalName) return null;
          return {
            originalName,
            expectedName: row.expectedName ? String(row.expectedName) : null,
            cleanedName: row.cleanedName ? String(row.cleanedName) : null,
            renamed: Boolean(row.renamed),
            mismatch: Boolean(row.mismatch),
            sessionId: row.sessionId ? String(row.sessionId) : null,
            source: row.source ? String(row.source) : null,
            fileSize: typeof row.fileSize === 'number' ? row.fileSize : null,
            mimeType: row.mimeType ? String(row.mimeType) : null,
            auditKey: row.auditKey ? String(row.auditKey) : null,
            recordedAt: isoOrNull(row.recordedAt as string | null),
          } satisfies ResumeAuditEntry;
        })
        .filter((x): x is ResumeAuditEntry => Boolean(x))
    : [];
  if (fromArray.length > 0) return fromArray;
  const originalName =
    typeof doc.resumeOriginalName === 'string'
      ? doc.resumeOriginalName.trim()
      : '';
  if (!originalName) return [];
  return [
    {
      originalName,
      expectedName: doc.resumeExpectedName ?? null,
      cleanedName: doc.resumeCleanedName ?? null,
      renamed: Boolean(doc.resumeRenamed),
      mismatch: Boolean(doc.resumeMismatch),
      sessionId: null,
      source: null,
      fileSize: null,
      mimeType: null,
      auditKey: null,
      recordedAt: null,
    },
  ];
}

/** Serialize VendorTask → Athens Bid Management / Lens task DTO. */
export function serializeVendorTask(doc: VendorTask): Record<string, unknown> {
  const applyUrl = doc.applyUrl ?? null;
  const sourceLabel = inferJobSource(applyUrl);
  const progress = deriveProgress(doc);

  const recording = doc.recordingPath
    ? {
        storagePath: String(doc.recordingPath),
        contentType: doc.recordingContentType || 'video/webm',
        sizeBytes: Number(doc.recordingSize || 0),
        sessionId: doc.bidSessionId || null,
      }
    : null;

  const recordings = normalizeRecordings(
    doc,
    recording
      ? {
          ...recording,
          durationSec: null,
          recordedStartAt: null,
          recordedEndAt: null,
          uploadedAt: null,
        }
      : null,
  );

  const status = (VENDOR_TASK_STATUSES as readonly string[]).includes(
    doc.status,
  )
    ? doc.status
    : 'pending';

  return {
    id: String(doc.id),
    applierName: doc.applierName ?? null,
    jobId: doc.jobId ?? null,
    title: doc.title || 'Untitled role',
    company: doc.company || '',
    applyUrl,
    source: doc.source || sourceLabel || '',
    location: doc.location || '',
    workMode: doc.workMode || '',
    matchScore: typeof doc.matchScore === 'number' ? doc.matchScore : null,
    status,
    progress,
    jobSource: { label: sourceLabel },
    addedAt: isoOrNull(doc.addedAt),
    updatedAt: isoOrNull(doc.updatedAt),
    completedAt: isoOrNull(doc.completedAt),
    bidReadyDate: isoOrNull(doc.bidReadyDate),
    recording,
    recordings,
    resumeAudits: normalizeResumeAudits(doc),
    reviewStatus: doc.reviewStatus || null,
    bidderName: doc.bidderName || null,
    bidderInProcess: Boolean(doc.bidderInProcess),
    bidderInProcessAt: isoOrNull(doc.bidderInProcessAt),
    recordingDurationSec:
      typeof doc.recordingDurationSec === 'number'
        ? doc.recordingDurationSec
        : null,
    recordingStartedAt: isoOrNull(doc.recordingStartedAt),
    recordingEndedAt: isoOrNull(doc.recordingEndedAt),
    biddingDurationSec:
      typeof doc.biddingDurationSec === 'number'
        ? doc.biddingDurationSec
        : null,
    flags: doc.flags && typeof doc.flags === 'object' ? doc.flags : null,
    analysisSummary:
      typeof doc.analysisSummary === 'string' ? doc.analysisSummary : null,
    analysisFormAnswers: Array.isArray(doc.analysisFormAnswers)
      ? doc.analysisFormAnswers
      : [],
    analysisMode:
      doc.analysisMode === 'llm' || doc.analysisMode === 'heuristic'
        ? doc.analysisMode
        : null,
    analysisPageUrl:
      typeof doc.analysisPageUrl === 'string' ? doc.analysisPageUrl : null,
    analysisPageTitle:
      typeof doc.analysisPageTitle === 'string' ? doc.analysisPageTitle : null,
    analysisUsage:
      doc.analysisUsage && typeof doc.analysisUsage === 'object'
        ? doc.analysisUsage
        : null,
    analysisRequestId:
      typeof doc.analysisRequestId === 'string' ? doc.analysisRequestId : null,
    analyzedAt: isoOrNull(doc.analyzedAt),
    flagAnalysisMode:
      doc.flagAnalysisMode === 'llm' || doc.flagAnalysisMode === 'heuristic'
        ? doc.flagAnalysisMode
        : null,
    flagAnalysisUsage:
      doc.flagAnalysisUsage && typeof doc.flagAnalysisUsage === 'object'
        ? doc.flagAnalysisUsage
        : null,
    flagAnalysisRequestId:
      typeof doc.flagAnalysisRequestId === 'string'
        ? doc.flagAnalysisRequestId
        : null,
    flagAnalyzedAt: isoOrNull(doc.flagAnalyzedAt),
    skipReason: typeof doc.skipReason === 'string' ? doc.skipReason : null,
    rejectReason: doc.rejectReason ?? null,
    rejectSource:
      doc.rejectSource === 'submitted' || doc.rejectSource === 'skipped'
        ? doc.rejectSource
        : null,
    rejectCount: Number(doc.rejectCount || 0),
    resubmitCount: Number(doc.resubmitCount || 0),
    lastRejectedAt: isoOrNull(doc.lastRejectedAt),
    lastResubmittedAt: isoOrNull(doc.lastResubmittedAt),
    resumeOriginalName: doc.resumeOriginalName ?? null,
    resumeExpectedName: doc.resumeExpectedName ?? null,
    resumeCleanedName: doc.resumeCleanedName ?? null,
    resumeRenamed: Boolean(doc.resumeRenamed),
    resumeMismatch: Boolean(doc.resumeMismatch),
    recommendedResumeStack: doc.recommendedResumeStack ?? null,
    recommendedResumeId: doc.recommendedResumeId ?? null,
    recommendedResumeReason: doc.recommendedResumeReason ?? null,
    useCustomizedResume: Boolean(doc.useCustomizedResume),
    recommendWarning: doc.recommendWarning ?? null,
    recommendedAt: isoOrNull(doc.recommendedAt),
    recommendMode:
      doc.recommendMode === 'llm' ||
      doc.recommendMode === 'heuristic' ||
      doc.recommendMode === 'manual'
        ? doc.recommendMode
        : null,
    recommendUsage:
      doc.recommendUsage && typeof doc.recommendUsage === 'object'
        ? doc.recommendUsage
        : null,
    recommendRequestId: doc.recommendRequestId ?? null,
    resumeStackMatch:
      doc.resumeStackMatch === 'match' ||
      doc.resumeStackMatch === 'mismatch' ||
      doc.resumeStackMatch === 'unknown'
        ? doc.resumeStackMatch
        : null,
  };
}
