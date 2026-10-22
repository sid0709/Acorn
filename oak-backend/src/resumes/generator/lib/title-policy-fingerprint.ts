import { createHash } from 'node:crypto';
import { TITLE_POLICY_VERSION } from '../constants/generator.constants';
import { cleanString } from './clean-string';

/** Slice of generator config that can affect generated section content. */
export function titlePolicyConfigSlice(config: unknown) {
  const c =
    config && typeof config === 'object'
      ? (config as Record<string, unknown>)
      : {};
  const steps = Array.isArray(c.steps) ? c.steps : [];
  const coverage = c.coverage as Record<string, unknown> | undefined;
  return {
    provider: c.provider ?? null,
    model: c.model ?? null,
    reasoningEffort: c.reasoningEffort ?? null,
    systemInstruction: c.systemInstruction ?? null,
    steps: steps.map((s) => {
      const step = (s && typeof s === 'object' ? s : {}) as Record<
        string,
        unknown
      >;
      return {
        purpose: step?.purpose ?? null,
        kind: step?.kind ?? null,
        prompt: step?.prompt ?? null,
        schema: step?.schema ?? null,
      };
    }),
    coverage: coverage?.settings ?? c.coverage ?? null,
  };
}

/** Fingerprint for cache/reuse invalidation. */
export function computeTitlePolicyFingerprint({
  dynamicCareerTitles,
  jobDescription,
  careers,
  config,
}: {
  dynamicCareerTitles?: boolean;
  jobDescription?: unknown;
  careers?: Array<{
    title?: unknown;
    company?: unknown;
    period?: unknown;
    description?: unknown;
  }>;
  config?: unknown;
} = {}): string {
  const careerRows = (Array.isArray(careers) ? careers : []).map((c) => ({
    title: cleanString(c?.title),
    company: cleanString(c?.company),
    period: cleanString(c?.period),
    description: cleanString(c?.description),
  }));
  const payload = {
    v: TITLE_POLICY_VERSION,
    dynamicCareerTitles: Boolean(dynamicCareerTitles),
    jd: cleanString(jobDescription),
    careers: careerRows,
    config: titlePolicyConfigSlice(config),
  };
  return createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}
