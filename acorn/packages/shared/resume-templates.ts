/** Built-in résumé templates. Layout is data; theme accents live on the document, not app chrome. */

export type ResumePurpose = "summary" | "skills" | "experience";
export const RESUME_PURPOSES: ResumePurpose[] = ["summary", "skills", "experience"];

export type ResumeSectionType = ResumePurpose | "education";
export const RESUME_SECTION_TYPES: ResumeSectionType[] = [
  "summary",
  "skills",
  "experience",
  "education",
];

export const RESUME_SECTION_LABEL: Record<ResumeSectionType, string> = {
  summary: "Summary",
  skills: "Skills",
  experience: "Experience",
  education: "Education",
};

export type ResumeHeadingStyle = "underline" | "bar" | "plain" | "centered-rules";

export type ResumeExperienceLayout =
  "default" | "standard" | "single-line" | "modern" | "harvard" | "jakes" | "two-col-entry" | "dev";

export type ResumeTemplateDef = {
  id: string;
  name: string;
  blurb: string;
  columns: 1 | 2;
  sidebar: ResumeSectionType[];
  sidebarSide: "left" | "right";
  sidebarWidthPct: number;
  sidebarTint: boolean;
  heading: ResumeHeadingStyle;
  headingAlign: "left" | "center";
  defaultHeaderAlign: "left" | "center";
  experienceLayout: ResumeExperienceLayout;
  contactIcons: boolean;
  nameColor: "accent" | "text";
  headingCase?: "upper" | "title";
  headingMuted?: boolean;
  headingColor?: "accent" | "text";
  nameUppercase?: boolean;
  nameRule?: boolean;
  topBar?: boolean;
  cornerAccent?: boolean;
  labelGutter?: boolean;
  defaults?: { font?: string; accent?: string };
};

export const RESUME_MONO_FONT =
  'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

const SINGLE = {
  columns: 1 as const,
  sidebar: [] as ResumeSectionType[],
  sidebarSide: "left" as const,
  sidebarWidthPct: 34,
  sidebarTint: false,
};

export const RESUME_TEMPLATES: ResumeTemplateDef[] = [
  {
    id: "classic",
    name: "Classic",
    blurb: "Single column · centered header · underlined headings",
    ...SINGLE,
    heading: "underline",
    headingAlign: "left",
    defaultHeaderAlign: "center",
    experienceLayout: "default",
    contactIcons: false,
    nameColor: "accent",
  },
  {
    id: "centered",
    name: "Centered",
    blurb: "Single column · centered header & section headings",
    ...SINGLE,
    heading: "underline",
    headingAlign: "center",
    defaultHeaderAlign: "center",
    experienceLayout: "default",
    contactIcons: false,
    nameColor: "accent",
  },
  {
    id: "minimal",
    name: "Minimal",
    blurb: "Single column · left header · clean headings",
    ...SINGLE,
    heading: "plain",
    headingAlign: "left",
    defaultHeaderAlign: "left",
    experienceLayout: "default",
    contactIcons: false,
    nameColor: "accent",
  },
  {
    id: "accent-bar",
    name: "Accent Bar",
    blurb: "Single column · left header · accent-bar headings",
    ...SINGLE,
    heading: "bar",
    headingAlign: "left",
    defaultHeaderAlign: "left",
    experienceLayout: "default",
    contactIcons: false,
    nameColor: "accent",
  },
  {
    id: "sidebar",
    name: "Two-Column",
    blurb: "Sidebar (skills + education) · main (summary + experience)",
    columns: 2,
    sidebar: ["skills", "education"],
    sidebarSide: "left",
    sidebarWidthPct: 34,
    sidebarTint: true,
    heading: "underline",
    headingAlign: "left",
    defaultHeaderAlign: "center",
    experienceLayout: "default",
    contactIcons: false,
    nameColor: "accent",
  },
  {
    id: "standard",
    name: "Standard",
    blurb: "Reverse-chronological · the safe ATS default · icons in header",
    ...SINGLE,
    heading: "underline",
    headingAlign: "left",
    defaultHeaderAlign: "center",
    experienceLayout: "standard",
    contactIcons: true,
    nameColor: "accent",
    defaults: { font: "Times New Roman", accent: "#1f3a5f" },
  },
  {
    id: "compact",
    name: "Compact",
    blurb: "High-density · single-line roles · fits long histories",
    ...SINGLE,
    heading: "underline",
    headingAlign: "left",
    defaultHeaderAlign: "center",
    experienceLayout: "single-line",
    contactIcons: true,
    nameColor: "accent",
    defaults: { font: "Times New Roman", accent: "#1f3a5f" },
  },
  {
    id: "modern",
    name: "Modern",
    blurb: "Sans-serif · blue accent · clean tech look",
    ...SINGLE,
    heading: "plain",
    headingAlign: "left",
    defaultHeaderAlign: "left",
    experienceLayout: "modern",
    contactIcons: true,
    nameColor: "accent",
    defaults: { font: "Inter", accent: "#2563eb" },
  },
  {
    id: "harvard",
    name: "Harvard",
    blurb: "Centered headings with rules · company-first · academic",
    ...SINGLE,
    heading: "centered-rules",
    headingAlign: "center",
    defaultHeaderAlign: "center",
    experienceLayout: "harvard",
    contactIcons: false,
    nameColor: "text",
    defaults: { font: "Times New Roman", accent: "#1f2937" },
  },
  {
    id: "jakes",
    name: "Jake's",
    blurb: "LaTeX-style dense single column · company-first · italic roles",
    ...SINGLE,
    heading: "underline",
    headingAlign: "left",
    defaultHeaderAlign: "center",
    experienceLayout: "jakes",
    contactIcons: false,
    nameColor: "text",
    defaults: { font: "Georgia", accent: "#1a1a1a" },
  },
  {
    id: "bold",
    name: "Bold",
    blurb: "Top accent bar · name rule · title-case headings · single-line roles",
    ...SINGLE,
    heading: "plain",
    headingAlign: "left",
    defaultHeaderAlign: "left",
    experienceLayout: "single-line",
    contactIcons: true,
    nameColor: "text",
    headingCase: "title",
    nameRule: true,
    topBar: true,
    headingColor: "text",
    defaults: { font: "Inter", accent: "#2f6df6" },
  },
  {
    id: "alternative",
    name: "Alternative",
    blurb: "Per-entry two columns · uppercase name · corner accent",
    ...SINGLE,
    heading: "plain",
    headingAlign: "left",
    defaultHeaderAlign: "left",
    experienceLayout: "two-col-entry",
    contactIcons: true,
    nameColor: "text",
    headingMuted: true,
    nameUppercase: true,
    cornerAccent: true,
    defaults: { font: "Inter", accent: "#2563eb" },
  },
  {
    id: "dev-compact",
    name: "Dev Compact",
    blurb: "Monospace · company-first · dividers · dense",
    ...SINGLE,
    heading: "plain",
    headingAlign: "left",
    defaultHeaderAlign: "left",
    experienceLayout: "dev",
    contactIcons: false,
    nameColor: "text",
    headingCase: "title",
    headingMuted: true,
    defaults: { font: RESUME_MONO_FONT, accent: "#111827" },
  },
  {
    id: "dev",
    name: "Dev",
    blurb: "Monospace · section labels in a left gutter",
    ...SINGLE,
    heading: "plain",
    headingAlign: "left",
    defaultHeaderAlign: "left",
    experienceLayout: "dev",
    contactIcons: false,
    nameColor: "text",
    headingCase: "title",
    headingMuted: true,
    labelGutter: true,
    defaults: { font: RESUME_MONO_FONT, accent: "#111827" },
  },
];

export const RESUME_TEMPLATE_IDS = RESUME_TEMPLATES.map((template) => template.id);

export function resumeTemplateById(id: string): ResumeTemplateDef {
  return RESUME_TEMPLATES.find((template) => template.id === id) ?? RESUME_TEMPLATES[0];
}

export const UPLOADED_TEMPLATE_PREFIX = "upload:";

export function isUploadedTemplateId(templateId: string): boolean {
  return templateId.startsWith(UPLOADED_TEMPLATE_PREFIX);
}

export function uploadedTemplateDocumentId(templateId: string): string {
  return templateId.startsWith(UPLOADED_TEMPLATE_PREFIX)
    ? templateId.slice(UPLOADED_TEMPLATE_PREFIX.length)
    : templateId;
}

export function uploadedTemplateId(documentId: string): string {
  return `${UPLOADED_TEMPLATE_PREFIX}${documentId}`;
}
