import { cleanString } from './clean-string';

/** Extract skill names from Job.aiSkills for `{job_skills}` tokens. */
export function jobSkillNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      const name = cleanString(entry);
      if (name) names.push(name);
      continue;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const name = cleanString((entry as { name?: unknown }).name);
    if (name) names.push(name);
  }
  return names;
}
