import type { BidUiStatus } from '../constants/bid-status.constants';
import { dayKeyFromIso } from '../lib/day-key';
import { isoOrNull } from '../lib/iso';
import { deriveBidUiStatus } from './bid-ui-status';

export type BidReportRow = {
  dayKey: string;
  status: BidUiStatus;
  company: string;
  title: string;
  source: string;
  location: string;
  bidder: string;
  biddingDurationSec: number | null;
  recordingDurationSec: number | null;
  matchScore: number | null;
  skipReason: string | null;
  rejectReason: string | null;
  rejectSource: string | null;
  rejectCount: number;
  resubmitCount: number;
  resumeMismatch: boolean;
  applyUrl: string | null;
  completedAt: string | null;
};

const REPORT_SELECT = {
  title: true,
  company: true,
  source: true,
  location: true,
  applyUrl: true,
  matchScore: true,
  status: true,
  reviewStatus: true,
  bidderInProcess: true,
  bidderName: true,
  applierName: true,
  addedAt: true,
  completedAt: true,
  bidReadyDate: true,
  biddingDurationSec: true,
  skipReason: true,
  rejectReason: true,
  rejectSource: true,
  rejectCount: true,
  resubmitCount: true,
  resumeMismatch: true,
  recordingDurationSec: true,
} as const;

export const BID_REPORT_SELECT = REPORT_SELECT;

function text(value: unknown, fallback = ''): string {
  const raw = String(value ?? '').trim();
  return raw || fallback;
}

function numOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

export function mapVendorTaskToReportRow(task: {
  title?: string | null;
  company?: string | null;
  source?: string | null;
  location?: string | null;
  applyUrl?: string | null;
  matchScore?: number | null;
  status?: string | null;
  reviewStatus?: string | null;
  bidderInProcess?: boolean | null;
  bidderName?: string | null;
  applierName?: string | null;
  addedAt?: Date | string | null;
  completedAt?: Date | string | null;
  bidReadyDate?: Date | string | null;
  biddingDurationSec?: number | null;
  skipReason?: string | null;
  rejectReason?: string | null;
  rejectSource?: string | null;
  rejectCount?: number | null;
  resubmitCount?: number | null;
  resumeMismatch?: boolean | null;
  recordingDurationSec?: number | null;
}): BidReportRow {
  const pooled = task.bidReadyDate || task.addedAt;
  return {
    dayKey: dayKeyFromIso(pooled),
    status: deriveBidUiStatus(task),
    company: text(task.company, 'Unknown'),
    title: text(task.title, 'Untitled role'),
    source: text(task.source, 'Other'),
    location: text(task.location, '—'),
    bidder: text(task.bidderName || task.applierName, 'Unassigned'),
    biddingDurationSec: numOrNull(task.biddingDurationSec),
    recordingDurationSec: numOrNull(task.recordingDurationSec),
    matchScore: numOrNull(task.matchScore),
    skipReason: text(task.skipReason) || null,
    rejectReason: text(task.rejectReason) || null,
    rejectSource: text(task.rejectSource) || null,
    rejectCount: Number(task.rejectCount || 0) || 0,
    resubmitCount: Number(task.resubmitCount || 0) || 0,
    resumeMismatch: Boolean(task.resumeMismatch),
    applyUrl: text(task.applyUrl) || null,
    completedAt: isoOrNull(task.completedAt),
  };
}
