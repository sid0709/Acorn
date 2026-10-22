/**
 * Canonical job metadata capsule (stored on Job / TempJob.metadata).
 * details: location (was position), salary (was money); companyTags and date removed.
 * scrape: Extension/LI extras that never promote into Job.
 */
export type JobDetailsCapsule = {
  location?: string;
  time?: string;
  remote?: string;
  seniority?: string;
  salary?: string;
};

export type JobScrapeCapsule = {
  tags?: string[];
  companyTags?: string[];
  skills?: string[];
  applicants?: { count?: number; text?: string };
  duplicateWindowDays?: number;
  scrapefrom?: string;
};

export type JobMetadataCapsule = {
  legacyId?: string;
  companyLogo?: string;
  details?: JobDetailsCapsule;
  titleReview?: unknown;
  /** AI Analyze lease / error capsule (staging); stripped or kept as opaque on promote. */
  aiAnalyze?: unknown;
  /** Pending human review when JD remote disagrees with scrape/existing remote. */
  remoteReview?: unknown;
  scrape?: JobScrapeCapsule;
};

type RawDetails = Record<string, unknown>;

function asObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function pickString(
  details: RawDetails,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = details[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function asStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const next = raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  return next;
}

/** Normalize legacy or current details → { location, time, remote, seniority, salary }. */
export function normalizeJobDetails(
  raw: unknown,
): JobDetailsCapsule | undefined {
  const details = asObject(raw);
  if (!details) return undefined;

  const location = pickString(details, 'location', 'position');
  const time = pickString(details, 'time');
  const remote = pickString(details, 'remote');
  const seniority = pickString(details, 'seniority');
  const salary = pickString(details, 'salary', 'money');

  const next: JobDetailsCapsule = {};
  if (location) next.location = location;
  if (time) next.time = time;
  if (remote) next.remote = remote;
  if (seniority) next.seniority = seniority;
  if (salary) next.salary = salary;
  return Object.keys(next).length ? next : undefined;
}

/** Normalize scraper-only extras under metadata.scrape. */
export function normalizeJobScrape(raw: unknown): JobScrapeCapsule | undefined {
  const scrape = asObject(raw);
  if (!scrape) return undefined;

  const next: JobScrapeCapsule = {};
  const tags = asStringArray(scrape.tags);
  if (tags) next.tags = tags;
  const companyTags = asStringArray(scrape.companyTags);
  if (companyTags) next.companyTags = companyTags;
  const skills = asStringArray(scrape.skills);
  if (skills) next.skills = skills;

  const applicants = asObject(scrape.applicants);
  if (applicants) {
    const count =
      typeof applicants.count === 'number' && Number.isFinite(applicants.count)
        ? applicants.count
        : undefined;
    const text =
      typeof applicants.text === 'string' && applicants.text.trim()
        ? applicants.text.trim()
        : undefined;
    if (count != null || text) {
      next.applicants = {
        ...(count != null ? { count } : {}),
        ...(text ? { text } : {}),
      };
    }
  }
  const scrapefrom =
    typeof scrape.scrapefrom === 'string' && scrape.scrapefrom.trim()
      ? scrape.scrapefrom.trim()
      : undefined;

  if (scrapefrom) {
    next.scrapefrom = scrapefrom;
  }
  if (
    typeof scrape.duplicateWindowDays === 'number' &&
    Number.isFinite(scrape.duplicateWindowDays)
  ) {
    next.duplicateWindowDays = scrape.duplicateWindowDays;
  }

  return Object.keys(next).length ? next : undefined;
}

/**
 * Drop companyTags / details.date at top level; rename position→location, money→salary.
 * Preserve scrape capsule when present.
 */
export function normalizeJobMetadata(
  raw: unknown,
): JobMetadataCapsule | undefined {
  const meta = asObject(raw);
  if (!meta) return undefined;

  const next: JobMetadataCapsule = {};
  if (typeof meta.legacyId === 'string' && meta.legacyId.trim()) {
    next.legacyId = meta.legacyId.trim();
  }
  if (typeof meta.companyLogo === 'string' && meta.companyLogo.trim()) {
    next.companyLogo = meta.companyLogo.trim();
  }
  const details = normalizeJobDetails(meta.details);
  if (details) next.details = details;
  if (meta.titleReview != null) next.titleReview = meta.titleReview;
  if (meta.aiAnalyze != null) next.aiAnalyze = meta.aiAnalyze;
  if (meta.remoteReview != null) next.remoteReview = meta.remoteReview;
  const scrape = normalizeJobScrape(meta.scrape);
  if (scrape) next.scrape = scrape;
  return Object.keys(next).length ? next : undefined;
}

/** Catalog Job metadata: drop scrape extras before register. */
export function toCatalogJobMetadata(
  raw: unknown,
): JobMetadataCapsule | undefined {
  const meta = normalizeJobMetadata(raw);
  if (!meta) return undefined;
  const rest: JobMetadataCapsule = {};
  if (meta.legacyId) rest.legacyId = meta.legacyId;
  if (meta.companyLogo) rest.companyLogo = meta.companyLogo;
  if (meta.details) rest.details = meta.details;
  if (meta.titleReview != null) rest.titleReview = meta.titleReview;
  if (meta.remoteReview != null) rest.remoteReview = meta.remoteReview;
  //REVIEW: stop!
  if (meta.scrape?.scrapefrom) {
    rest.scrape = {
      scrapefrom: meta.scrape.scrapefrom,
    };
  }

  return Object.keys(rest).length ? rest : undefined;
}
