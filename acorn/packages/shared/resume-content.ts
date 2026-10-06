import type { ResumePurpose } from "./resume-templates";

export type ResumeCareerEntry = {
  company: string;
  title: string;
  period: string;
  description: string;
};

export type ResumeEducationEntry = {
  school: string;
  degree: string;
  period: string;
};

export type ResumeIdentity = {
  fullName: string;
  location: string;
  email: string;
  phone: string;
  linkedin: string;
  careers: ResumeCareerEntry[];
  education: ResumeEducationEntry[];
};

export type ResumePreviewCareer = {
  title: string;
  company: string;
  location: string;
  period: string;
  bullets: string[];
};

export type ResumeGeneratedContent = {
  summary: string | null;
  skills: { category: string; items: string[] }[] | null;
  experience: ResumePreviewCareer[] | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function emptyResumeIdentity(): ResumeIdentity {
  return {
    fullName: "",
    location: "",
    email: "",
    phone: "",
    linkedin: "",
    careers: [],
    education: [],
  };
}

export function normalizeGeneratedContent(
  sections: Record<string, unknown> | null | undefined,
): ResumeGeneratedContent {
  const summarySec = asRecord(sections?.summary);
  const skillsSec = asRecord(sections?.skills);
  const expSec = asRecord(sections?.experience);

  const summary = typeof summarySec.summary === "string" ? summarySec.summary : null;

  const skillsArr = Array.isArray(skillsSec.skills) ? skillsSec.skills : null;
  const skills = skillsArr
    ? skillsArr
        .map((group) => {
          const row = asRecord(group);
          const items = Array.isArray(row.items) ? row.items.map(String) : [];
          return { category: String(row.category ?? ""), items };
        })
        .filter((group) => group.category || group.items.length)
    : null;

  const expArr = Array.isArray(expSec.experiences)
    ? expSec.experiences
    : Array.isArray(expSec.experience)
      ? expSec.experience
      : null;
  const experience = expArr
    ? expArr.map((entry) => {
        const row = asRecord(entry);
        return {
          title: String(row.title ?? row.role ?? ""),
          company: String(row.company ?? ""),
          location: String(row.location ?? ""),
          period: String(row.period ?? row.dates ?? ""),
          bullets: Array.isArray(row.bullets) ? row.bullets.map(String) : [],
        };
      })
    : null;

  return {
    summary,
    skills: skills && skills.length ? skills : null,
    experience: experience && experience.length ? experience : null,
  };
}

export function mergeGeneratedSection(
  prev: ResumeGeneratedContent | null,
  purpose: ResumePurpose | string,
  output: unknown,
): ResumeGeneratedContent {
  const base = prev ?? { summary: null, skills: null, experience: null };
  const one = normalizeGeneratedContent({ [purpose]: output });
  if (purpose === "summary") return { ...base, summary: one.summary ?? base.summary };
  if (purpose === "skills") return { ...base, skills: one.skills ?? base.skills };
  if (purpose === "experience") return { ...base, experience: one.experience ?? base.experience };
  return base;
}

export function resumeTextFromSections(
  sections: Record<string, unknown> | null | undefined,
): string {
  const content = normalizeGeneratedContent(sections);
  const parts: string[] = [];
  if (content.summary) parts.push(content.summary);
  for (const group of content.skills ?? []) {
    parts.push([group.category, ...group.items].filter(Boolean).join(" "));
  }
  for (const role of content.experience ?? []) {
    parts.push([role.title, role.company, role.location, role.period, ...role.bullets].join(" "));
  }
  return parts.join("\n");
}
