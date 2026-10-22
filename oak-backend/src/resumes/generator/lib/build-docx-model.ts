import { cleanString } from './clean-string';
import { formatResumePeriodLabel } from './format-resume-date';

type Dict = Record<string, unknown>;

/**
 * Build the structured DOCX model from a stored generation run
 * (sections + identity + config theme/layout).
 */
export function buildDocxModelFromGeneration(input: {
  sections: Dict;
  identity: Dict;
  config?: Dict;
}): Record<string, unknown> {
  const sections = input.sections;
  const identity = input.identity;
  const config =
    input.config && typeof input.config === 'object' ? input.config : {};
  const theme =
    config.theme && typeof config.theme === 'object'
      ? (config.theme as Dict)
      : {};
  const layout = Array.isArray(config.layout)
    ? (config.layout as Dict[])
    : [
        { type: 'summary', title: 'Professional Summary' },
        { type: 'skills', title: 'Skills' },
        { type: 'experience', title: 'Experience' },
        { type: 'education', title: 'Education' },
      ];

  const accent = cleanString(theme.accent) || '#1f3a5f';
  const text = cleanString(theme.text) || '#1a1a1a';
  const baseSize = Number(theme.baseSize) || 10.5;
  const titleSize = Number(theme.titleSize) || 12;
  const nameSize = Number(theme.nameSize) || 24;

  const built = layout
    .map((row) => {
      const type = cleanString(row.type || row.id);
      if (!type) return null;
      const title =
        cleanString(row.title) ||
        ({
          summary: 'Professional Summary',
          skills: 'Skills',
          experience: 'Experience',
          education: 'Education',
        }[type] ??
          type);
      const headingColor = cleanString(row.titleColor) || accent;
      const bodySizePt = Number(row.bodySize) || baseSize;
      const titleSizePt = Number(row.titleSize) || titleSize;
      const base = {
        type,
        title,
        titleSizePt,
        bodySizePt,
        headingColor,
        headingStyle: 'underline' as const,
      };
      if (type === 'summary') {
        const summary =
          typeof (sections.summary as Dict | undefined)?.summary === 'string'
            ? cleanString((sections.summary as Dict).summary)
            : typeof sections.summary === 'string'
              ? cleanString(sections.summary)
              : '';
        return { ...base, summary };
      }
      if (type === 'skills') {
        const groups = Array.isArray(
          (sections.skills as Dict | undefined)?.skills,
        )
          ? ((sections.skills as Dict).skills as Dict[])
          : [];
        return {
          ...base,
          skills: groups.map((g) => ({
            category: cleanString(g.category),
            items: Array.isArray(g.items)
              ? g.items.map((item) => cleanString(item)).filter(Boolean)
              : [],
          })),
        };
      }
      if (type === 'experience') {
        const exps = Array.isArray(
          (sections.experience as Dict | undefined)?.experiences,
        )
          ? ((sections.experience as Dict).experiences as Dict[])
          : Array.isArray((sections.experience as Dict | undefined)?.experience)
            ? ((sections.experience as Dict).experience as Dict[])
            : [];
        return {
          ...base,
          experience: exps.map((e) => ({
            title: cleanString(e.title),
            company: cleanString(e.company),
            period: formatResumePeriodLabel(cleanString(e.period)),
            bullets: Array.isArray(e.bullets)
              ? e.bullets.map((b) => cleanString(b)).filter(Boolean)
              : [],
          })),
        };
      }
      if (type === 'education') {
        const list = Array.isArray(identity.education)
          ? (identity.education as Dict[])
          : Array.isArray((sections.education as Dict | undefined)?.education)
            ? ((sections.education as Dict).education as Dict[])
            : Array.isArray(
                  (sections.education as Dict | undefined)?.educations,
                )
              ? ((sections.education as Dict).educations as Dict[])
              : [];
        return {
          ...base,
          education: list.map((e) => ({
            school: cleanString(e.school),
            degree: cleanString(e.degree),
            period: formatResumePeriodLabel(
              cleanString(e.period || e.graduationDate),
            ),
          })),
        };
      }
      return null;
    })
    .filter(Boolean);

  return {
    name: cleanString(identity.fullName) || 'Your Name',
    contact: [
      identity.location,
      identity.email,
      identity.phone,
      identity.linkedin,
    ]
      .map((x) => cleanString(x))
      .filter(Boolean),
    headerAlign: theme.headerAlign === 'left' ? 'left' : 'center',
    headingAlign: 'left',
    nameSizePt: nameSize,
    nameColor: accent,
    baseSizePt: baseSize,
    textColor: text,
    accentColor: accent,
    sections: built,
  };
}
