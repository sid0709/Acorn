import {
  JOB_REMOTE_VALUES,
  type JobRemoteValue,
} from '../constants/job-remote.constants';

const CANONICAL = new Set<string>(JOB_REMOTE_VALUES);

/** Map scrape / model work-mode text onto the product labels. */
export function canonicalizeJobRemote(
  raw: unknown,
): JobRemoteValue | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  if (CANONICAL.has(text)) return text as JobRemoteValue;

  const normalized = text.toLowerCase();
  if (normalized.includes('hybrid')) return 'Hybrid';
  if (
    normalized.includes('on-site') ||
    normalized.includes('onsite') ||
    normalized.includes('on site') ||
    normalized.includes('in-office') ||
    normalized.includes('in office') ||
    normalized.includes('in-person') ||
    normalized.includes('in person')
  ) {
    return 'On-site';
  }
  if (
    normalized.includes('remote') ||
    normalized === 'wfh' ||
    normalized.includes('work from home') ||
    normalized.includes('telecommute')
  ) {
    return 'Remote';
  }
  return undefined;
}

export function clampRemoteConfidence(raw: unknown): number | undefined {
  let value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return undefined;
  if (value > 1 && value <= 100) value = value / 100;
  return Math.max(0, Math.min(1, value));
}
