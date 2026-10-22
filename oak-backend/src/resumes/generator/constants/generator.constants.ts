/** Protocol versions and closed vocabularies for the Resume Generator. */

export const RESUME_GENERATOR_CONFIG_VERSION = 4 as const;
export const RESUME_COVERAGE_ANALYSIS_VERSION = 3 as const;
export const RESUME_COVERAGE_CONTRACT_VERSION = 2 as const;
export const TITLE_POLICY_VERSION = 5 as const;

/** Background task input retention (7 days). */
export const BACKGROUND_INPUT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export const PURPOSES = [
  'summary',
  'skills',
  'experience',
  'education',
] as const;
export type GeneratorPurpose = (typeof PURPOSES)[number];
export const PURPOSE_SET = new Set<string>(PURPOSES);

export const CATEGORIES = new Set<string>([
  'language',
  'framework',
  'platform',
  'protocol',
  'data',
  'cloud',
  'tool',
  'method',
  'domain',
]);

export const DECISIONS = new Set<string>(['used', 'familiar', 'exclude']);
export const PLACEMENTS = new Set<string>(['skills', 'experience']);
export const ORIGINS = new Set<string>(['jd', 'career', 'inferred']);
export const CONFIDENCES = new Set<string>([
  'explicit',
  'strongly_implied',
  'commonly_expected',
]);

export type CoverageCategory =
  | 'language'
  | 'framework'
  | 'platform'
  | 'protocol'
  | 'data'
  | 'cloud'
  | 'tool'
  | 'method'
  | 'domain';
export type CoverageDecision = 'used' | 'familiar' | 'exclude';
export type CoveragePlacement = 'skills' | 'experience';
export type CoverageOrigin = 'jd' | 'career' | 'inferred';
export type CoverageConfidence =
  'explicit' | 'strongly_implied' | 'commonly_expected';
