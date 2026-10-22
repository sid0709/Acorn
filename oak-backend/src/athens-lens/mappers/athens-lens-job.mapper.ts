import { isoOrNull } from '../../bids/lib/iso';
import {
  normalizeJobMetadata,
  type JobMetadataCapsule,
} from '../../jobs/mappers/job-metadata.mapper';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function displayText(value: unknown, fallback = ''): string {
  const raw = text(value);
  return raw || fallback;
}

function isoDate(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ''
      : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  return '';
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

function applicantsText(meta: JobMetadataCapsule | undefined): string {
  const applicants = meta?.scrape?.applicants;
  if (!applicants) return '';
  if (text(applicants.text)) return text(applicants.text);
  const count = Number(applicants.count);
  return Number.isFinite(count) && count >= 0 ? `${count} applicants` : '';
}

function skillNames(
  aiSkills: unknown,
  meta: JobMetadataCapsule | undefined,
): string[] {
  if (Array.isArray(aiSkills)) {
    const fromAi = (aiSkills as Array<{ name?: string }>)
      .map((s) => text(s?.name))
      .filter(Boolean);
    if (fromAi.length) return [...new Set(fromAi)];
  }
  return Array.isArray(meta?.scrape?.skills) ? [...meta.scrape.skills] : [];
}

/** Lens Bid Ready job shape — string fields match Athens-server (never null). */
export function mapAthensLensJob(
  job: {
    id: string;
    title: string;
    companyName: string;
    postedAt: Date;
    applyLink: string | null;
    description: string | null;
    source: string;
    metadata: unknown;
    aiSkills: unknown;
  },
  status: { bidReadyAt: Date | null; postedAt: Date | null },
  recommend?: {
    recommendedResumeStack: string | null;
    recommendedResumeReason: string | null;
    useCustomizedResume: boolean;
    recommendWarning: string | null;
    recommendedAt: Date | null;
  } | null,
) {
  const meta = normalizeJobMetadata(job.metadata);
  const details = meta?.details ?? {};

  const recommendedResumeStack =
    text(recommend?.recommendedResumeStack) || null;
  const recommendedResumeReason =
    text(recommend?.recommendedResumeReason) || null;
  const recommendWarning = text(recommend?.recommendWarning) || null;

  return {
    id: job.id,
    title: text(job.title) || 'Untitled role',
    company: text(job.companyName) || 'Unknown company',
    companyLogoUrl: httpUrl(meta?.companyLogo),
    location: displayText(details.location, 'Not specified'),
    workMode: workMode(details.remote),
    employmentType: displayText(details.time, 'Not specified'),
    seniority: displayText(details.seniority, 'Not specified'),
    salary: displayText(details.salary, 'Undisclosed'),
    experience: '',
    postedAt: isoDate(status.postedAt ?? job.postedAt),
    skills: skillNames(job.aiSkills, meta),
    tags: Array.isArray(meta?.scrape?.tags) ? [...meta.scrape.tags] : [],
    applicantsText: applicantsText(meta),
    description:
      text(job.description) || 'No job description has been provided.',
    responsibilities: [] as string[],
    qualifications: [] as string[],
    applyUrl: httpUrl(job.applyLink),
    bidReadyAt: isoDate(status.bidReadyAt),
    recommendedResumeStack,
    recommendedResumeReason,
    useCustomizedResume: Boolean(recommend?.useCustomizedResume),
    recommendWarning,
    recommendedAt: isoOrNull(recommend?.recommendedAt ?? null),
  };
}
