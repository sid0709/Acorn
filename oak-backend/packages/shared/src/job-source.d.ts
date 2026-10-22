export type JobSourceType =
  'Legal' | 'Autobid' | 'Extension' | 'OneStep' | 'MultiStep' | 'Other';

export interface JobSourceEntry {
  readonly type: JobSourceType | string;
  readonly title: string;
  readonly url: string;
}

export interface JobSourceGroup {
  readonly type: string;
  readonly titles: readonly string[];
}

export const JOB_SOURCES: readonly JobSourceEntry[];
export const JOB_SOURCE_TITLES: readonly string[];
export const JOB_SOURCE_GROUPS: readonly JobSourceGroup[];
export const SOURCE_MAP_VERSION: string;
export const JOB_SCRAPE_SOURCE_TITLES: readonly string[];
export const OTHER_JOB_SCRAPE_SOURCE: string;

export function inferJobSource(applyLink: string | null | undefined): string;
