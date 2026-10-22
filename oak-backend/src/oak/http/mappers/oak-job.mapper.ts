import { isoOrNull } from '../../../bids/lib/iso';
import { normalizeJobMetadata } from '../../../jobs/mappers/job-metadata.mapper';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function displayText(value: unknown, fallback = ''): string {
  const raw = text(value);
  return raw || fallback;
}

function httpUrl(value: unknown): string {
  try {
    const raw = text(value);
    if (!raw) return '';
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : '';
  } catch {
    return '';
  }
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function workMode(value: unknown): string {
  const displayed = displayText(value);
  const normalized = displayed.toLowerCase();
  if (normalized.includes('remote')) return 'Remote';
  if (normalized.includes('hybrid')) return 'Hybrid';
  if (
    normalized.includes('on-site') ||
    normalized.includes('onsite') ||
    normalized.includes('office')
  ) {
    return 'On-site';
  }
  return displayed || 'Not specified';
}

/** Compact Worker Pool row for the Oak extension sidebar. */
export function mapOakWorkerJob(
  job: {
    id: string;
    title: string;
    companyName: string;
    applyLink: string | null;
    description?: string | null;
    metadata: unknown;
  },
  status: { workerPoolAt: Date | null },
  recommend?: {
    recommendedResumeStack: string | null;
    recommendedResumeId: string | null;
    recommendedResumeReason: string | null;
    recommendWarning: string | null;
    recommendedAt: Date | string | null;
  } | null,
  generatedResume = false,
) {
  const meta = normalizeJobMetadata(job.metadata);
  const details = meta?.details ?? {};

  return {
    id: job.id,
    title: text(job.title) || 'Untitled role',
    company: text(job.companyName) || 'Unknown company',
    companyLogoUrl: httpUrl(meta?.companyLogo),
    location: displayText(details.location, 'Not specified'),
    workMode: workMode(details.remote),
    applyUrl: httpUrl(job.applyLink),
    jobDescription: text(job.description),
    hasJobDescription: Boolean(text(job.description)),
    workerPoolAt: isoDate(status.workerPoolAt),
    generatedResume,
    recommendedResumeStack: text(recommend?.recommendedResumeStack) || null,
    recommendedResumeId: text(recommend?.recommendedResumeId) || null,
    recommendedResumeReason: text(recommend?.recommendedResumeReason) || null,
    recommendWarning: text(recommend?.recommendWarning) || null,
    recommendedAt: isoOrNull(recommend?.recommendedAt ?? null),
  };
}
