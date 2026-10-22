import type { Prisma } from '@prisma/client';
import {
  EXTENSION_CREATED_BY,
  JOB_AI_SKILL_STATUS_PENDING,
  JOB_MODEL_SCHEMA_CODE,
  JOB_SOURCE_CATALOGS,
} from '../constants/job-ingest.constants';
import { JOB_TITLE_REVIEW_LABELS } from '../constants/job-pipeline.constants';
import { inferJobSource } from '../lib/infer-job-source';
import {
  cleanText,
  isHttpUrl,
  parseRelativePostedAt,
} from '../lib/parse-relative-posted-at';
import {
  normalizeJobDetails,
  normalizeJobMetadata,
  type JobMetadataCapsule,
  type JobScrapeCapsule,
} from './job-metadata.mapper';

export type PrenormTempJobInput = Prisma.TempJobCreateInput;

export type PrenormResult =
  { ok: true; data: PrenormTempJobInput } | { ok: false; error: string };

function buildMetadata(
  partial: JobMetadataCapsule,
): Prisma.InputJsonValue | undefined {
  const normalized = normalizeJobMetadata(partial);
  if (!normalized) return undefined;
  return normalized as Prisma.InputJsonValue;
}

function scrapeDefaults(overrides: {
  title: string;
  companyName: string;
  source: string;
  postedAt: Date;
  postedAgo?: string;
  description?: string;
  companyLink?: string;
  applyLink?: string;
  createdBy: string;
  metadata?: JobMetadataCapsule;
}): PrenormTempJobInput {
  return {
    title: overrides.title,
    companyName: overrides.companyName,
    source: overrides.source,
    postedAt: overrides.postedAt,
    ...(overrides.postedAgo ? { postedAgo: overrides.postedAgo } : {}),
    titleReviewLabel: JOB_TITLE_REVIEW_LABELS.PENDING,
    sourceCatalog: JOB_SOURCE_CATALOGS.EXTERNAL,
    ...(overrides.description ? { description: overrides.description } : {}),
    ...(overrides.companyLink ? { companyLink: overrides.companyLink } : {}),
    ...(overrides.applyLink ? { applyLink: overrides.applyLink } : {}),
    aiSkillStatus: JOB_AI_SKILL_STATUS_PENDING,
    modelSchemaCode: JOB_MODEL_SCHEMA_CODE,
    createdBy: overrides.createdBy,
    ...(overrides.metadata
      ? { metadata: buildMetadata(overrides.metadata) }
      : {}),
  };
}

/** Map LI-scrapper / expose/jobs body → TempJob create input. */
export function prenormLiScrapePayload(raw: unknown): PrenormResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const body = raw as Record<string, unknown>;

  const sender = cleanText(body.sender ?? body.Sender);
  const companyName = cleanText(body.companyName ?? body.company_name);
  const title = cleanText(body.jobTitle ?? body.job_title ?? body.title);
  const description = cleanText(
    body.jobDescription ?? body.job_description ?? body.description,
  );
  const applyLink = cleanText(
    body.jobLink ?? body.job_link ?? body.applyLink ?? body.url,
  );
  const companyIcon = cleanText(body.companyIcon ?? body.company_icon);
  const postedAgo = cleanText(
    body.postedAt ?? body.postedAgo ?? body.posted_ago,
  );
  const jobID = cleanText(body.jobID ?? body.job_id ?? body.jobId);
  const sourceRaw = cleanText(body.source);
  const source =
    sourceRaw || (applyLink ? inferJobSource(applyLink) : '') || 'Other';

  if (!sender) return { ok: false, error: 'sender is required' };
  if (!companyName) return { ok: false, error: 'companyName is required' };
  if (!title) return { ok: false, error: 'jobTitle is required' };
  if (!description) return { ok: false, error: 'jobDescription is required' };
  if (!applyLink) return { ok: false, error: 'jobLink is required' };
  if (!isHttpUrl(applyLink)) {
    return { ok: false, error: 'jobLink must be a valid http(s) URL' };
  }
  if (companyIcon && !isHttpUrl(companyIcon)) {
    return {
      ok: false,
      error: 'companyIcon must be a valid http(s) URL when provided',
    };
  }

  const metadata: JobMetadataCapsule = {};
  const scrape: JobScrapeCapsule = {};

  if (jobID) metadata.legacyId = jobID;
  if (companyIcon) metadata.companyLogo = companyIcon;

  // REVIEW: 🟢 review it ADD THIS BLOCK RIGHT HERE TO EXTRACT SCRAPEFROM
  const scrapefrom = cleanText(body.scrapefrom);
  if (scrapefrom) {
    scrape.scrapefrom = scrapefrom;
  }
  if (Object.keys(scrape).length) {
    metadata.scrape = scrape;
  }
  return {
    ok: true,
    data: scrapeDefaults({
      title,
      companyName,
      source,
      postedAt: parseRelativePostedAt(postedAgo || undefined),
      ...(postedAgo ? { postedAgo } : {}),
      description,
      applyLink,
      createdBy: EXTENSION_CREATED_BY.LI,
      metadata,
    }),
  };
}

/** Map Extension /jobs/bulk job object → TempJob create input. */
export function prenormExtensionScrapePayload(raw: unknown): PrenormResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Job must be a JSON object' };
  }
  const body = raw as Record<string, unknown>;
  const company =
    body.company &&
    typeof body.company === 'object' &&
    !Array.isArray(body.company)
      ? (body.company as Record<string, unknown>)
      : null;

  const title = cleanText(body.title);
  const companyName = cleanText(company?.name);
  const companyLogo = cleanText(company?.logo);
  const description = cleanText(body.description);
  const applyLink = cleanText(body.applyLink);
  const companyLink = cleanText(body.companyLink);
  const postedAgo = cleanText(body.postedAgo);
  const clientId =
    typeof body.id === 'number' && Number.isFinite(body.id)
      ? String(body.id)
      : cleanText(body.id);

  if (!title) return { ok: false, error: 'title is required' };
  if (!companyName) return { ok: false, error: 'company.name is required' };
  if (!description) return { ok: false, error: 'description is required' };
  if (!applyLink) return { ok: false, error: 'applyLink is required' };
  if (!isHttpUrl(applyLink)) {
    return { ok: false, error: 'applyLink must be a valid http(s) URL' };
  }
  if (companyLink && !isHttpUrl(companyLink)) {
    return {
      ok: false,
      error: 'companyLink must be a valid http(s) URL when provided',
    };
  }
  if (companyLogo && !isHttpUrl(companyLogo)) {
    return {
      ok: false,
      error: 'company.logo must be a valid http(s) URL when provided',
    };
  }

  const scrape: JobScrapeCapsule = {};
  if (Array.isArray(body.tags)) {
    scrape.tags = body.tags.filter((t): t is string => typeof t === 'string');
  }
  if (Array.isArray(company?.tags)) {
    scrape.companyTags = company.tags.filter(
      (t): t is string => typeof t === 'string',
    );
  }
  if (Array.isArray(body.skills)) {
    scrape.skills = body.skills.filter(
      (t): t is string => typeof t === 'string',
    );
  }
  if (
    body.applicants &&
    typeof body.applicants === 'object' &&
    !Array.isArray(body.applicants)
  ) {
    const applicants = body.applicants as Record<string, unknown>;
    scrape.applicants = {
      ...(typeof applicants.count === 'number'
        ? { count: applicants.count }
        : {}),
      ...(typeof applicants.text === 'string' ? { text: applicants.text } : {}),
    };
  }
  if (
    typeof body.duplicateWindowDays === 'number' &&
    Number.isFinite(body.duplicateWindowDays)
  ) {
    scrape.duplicateWindowDays = body.duplicateWindowDays;
  }

  // REVIEW: 🟢 review it ADD THIS BLOCK RIGHT HERE TO EXTRACT SCRAPEFROM
  const scrapefrom = cleanText(body.scrapefrom);
  if (scrapefrom) {
    scrape.scrapefrom = scrapefrom;
  }

  const metadata: JobMetadataCapsule = {};

  if (clientId) metadata.legacyId = clientId;
  if (companyLogo) metadata.companyLogo = companyLogo;
  const details = normalizeJobDetails(body.details);
  if (details) metadata.details = details;
  if (Object.keys(scrape).length) metadata.scrape = scrape;

  return {
    ok: true,
    data: scrapeDefaults({
      title,
      companyName,
      source: inferJobSource(applyLink),
      postedAt: parseRelativePostedAt(postedAgo || undefined),
      ...(postedAgo ? { postedAgo } : {}),
      description,
      applyLink,
      ...(companyLink ? { companyLink } : {}),
      createdBy: EXTENSION_CREATED_BY.JR,
      metadata,
    }),
  };
}
