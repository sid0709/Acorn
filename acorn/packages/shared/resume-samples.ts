import type { ResumeIdentity } from "./resume-content";

/** Placeholder copy the preview shows before a draft exists, so every template has something to lay out. */

export const RESUME_SAMPLE_SUMMARY =
  "Results-driven professional with a track record of shipping high-impact work. Adept at cross-functional collaboration and turning ambiguous goals into measurable outcomes.";

export const RESUME_SAMPLE_SKILLS: { category: string; items: string[] }[] = [
  { category: "Languages", items: ["TypeScript", "Python", "Go"] },
  { category: "Frameworks", items: ["React", "Node.js", "Next.js"] },
  { category: "Cloud & data", items: ["AWS", "PostgreSQL", "Docker"] },
];

export const RESUME_SAMPLE_BULLETS = [
  "Led a cross-functional team to ship a feature that lifted engagement 24%.",
  "Cut page load time 40% through targeted performance work.",
  "Mentored three engineers and introduced a code-review rubric.",
];

const SAMPLE_ROLES = [
  {
    title: "Senior Engineer",
    company: "Acme Corp",
    location: "Seattle, WA",
    period: "2022 – Present",
  },
  { title: "Software Engineer", company: "Globex", location: "Remote", period: "2019 – 2022" },
];

/** Roles shown in the sample. The profile's own roles win when it has any. */
export const RESUME_SAMPLE_ROLE_COUNT = SAMPLE_ROLES.length;

/** Sections for the preview endpoint: the profile's real roles with sample bullets, or sample roles. */
export function resumeSampleSections(identity: ResumeIdentity): Record<string, unknown> {
  const roles = identity.careers.length
    ? identity.careers.slice(0, RESUME_SAMPLE_ROLE_COUNT).map((career) => ({
        title: career.title,
        company: career.company,
        location: "",
        period: career.period,
      }))
    : SAMPLE_ROLES;
  return {
    summary: { summary: RESUME_SAMPLE_SUMMARY },
    skills: { skills: RESUME_SAMPLE_SKILLS },
    experience: {
      experiences: roles.map((role) => ({ ...role, bullets: RESUME_SAMPLE_BULLETS })),
    },
  };
}
