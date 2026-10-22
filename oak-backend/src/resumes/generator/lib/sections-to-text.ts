import { cleanString } from './clean-string';

type SectionsLike = {
  summary?: unknown;
  skills?: { skills?: unknown };
  experience?: { experiences?: unknown; experience?: unknown };
  education?: { education?: unknown; educations?: unknown };
};

type IdentityLike = {
  fullName?: unknown;
};

/** Flatten generated resume sections into plain text for analysis / storage. */
export function sectionsToText(
  sections: SectionsLike | null | undefined,
  identity?: IdentityLike | null,
): string {
  const parts: string[] = [];
  const summaryObj = sections?.summary;
  const summary =
    summaryObj && typeof summaryObj === 'object' && 'summary' in summaryObj
      ? (summaryObj as { summary?: unknown }).summary
      : summaryObj;
  if (typeof summary === 'string' && summary.trim()) {
    parts.push(`Summary\n${summary.trim()}`);
  }

  const groups = sections?.skills?.skills;
  if (Array.isArray(groups)) {
    const skillLines = groups
      .map((g) => {
        const group = (g && typeof g === 'object' ? g : {}) as Record<
          string,
          unknown
        >;
        const items = Array.isArray(group.items)
          ? group.items.map(String).filter(Boolean)
          : [];
        if (!items.length) return '';
        const cat = cleanString(group.category);
        return cat ? `${cat}: ${items.join(', ')}` : items.join(', ');
      })
      .filter(Boolean);
    if (skillLines.length) parts.push(`Skills\n${skillLines.join('\n')}`);
  }

  const exps =
    sections?.experience?.experiences ?? sections?.experience?.experience;
  if (Array.isArray(exps)) {
    const expLines = exps.map((e) => {
      const row = (e && typeof e === 'object' ? e : {}) as Record<
        string,
        unknown
      >;
      const title = cleanString(row.title);
      const company = cleanString(row.company);
      const period = cleanString(row.period);
      const bullets = Array.isArray(row.bullets)
        ? row.bullets.map(String).filter(Boolean)
        : [];
      return [title, company, period, ...bullets.map((b) => `- ${b}`)]
        .filter(Boolean)
        .join('\n');
    });
    if (expLines.length) parts.push(`Experience\n${expLines.join('\n\n')}`);
  }

  const edus =
    sections?.education?.education ?? sections?.education?.educations;
  if (Array.isArray(edus)) {
    const eduLines = edus.map((e) => {
      const row = (e && typeof e === 'object' ? e : {}) as Record<
        string,
        unknown
      >;
      const school = cleanString(row.school);
      const degree = cleanString(row.degree);
      const period = cleanString(row.period);
      return [school, degree, period].filter(Boolean).join(' · ');
    });
    if (eduLines.length) parts.push(`Education\n${eduLines.join('\n')}`);
  }

  if (identity?.fullName) parts.unshift(String(identity.fullName));
  return parts.join('\n\n');
}
