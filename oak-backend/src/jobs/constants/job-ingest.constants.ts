/** Extension scrape provenance when the client does not send createdBy/sender. */
export const EXTENSION_CREATED_BY = {
  JR: 'avalon-scrapper',
  LI: 'li-job-scraper',
} as const;

export const JOB_SOURCE_CATALOGS = {
  MARKET: 'market',
  EXTERNAL: 'external',
} as const;

/** Default aiSkillStatus for newly scraped temp rows. */
export const JOB_AI_SKILL_STATUS_PENDING = 'pending';

/** Re-export ingest env knobs for callers that already imported this module. */
export {
  JOB_DEDUP_WINDOW_DAYS,
  JOB_MODEL_SCHEMA_CODE,
} from './job-ingest.config';
