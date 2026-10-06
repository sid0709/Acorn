import {
  RESUME_PURPOSES,
  RESUME_SECTION_LABEL,
  RESUME_SECTION_TYPES,
  type ResumePurpose,
  type ResumeSectionType,
} from "./resume-templates";

export const RESUME_GENERATOR_CONFIG_VERSION = 4 as const;

export type ResumeStepKind = "fine-tune" | "final";
export type ResumeProviderId = "openrouter";
export type ResumeReasoningEffort =
  "default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ResumePaperSize = "letter" | "a4";

export type ResumeGenStep = {
  id: string;
  purpose: ResumePurpose;
  kind: ResumeStepKind;
  name: string;
  prompt: string;
  schema: string;
};

export type ResumeTheme = {
  font: string;
  baseSize: number;
  nameSize: number;
  titleSize: number;
  accent: string;
  text: string;
  headerAlign: "left" | "center";
  paper: ResumePaperSize;
  margin: number;
  /** Space between sections, in pt. */
  sectionGap: number;
  /** Space between roles and between schools, in pt. */
  entryGap: number;
  /** Body line height, unitless. */
  lineHeight: number;
};

/**
 * Editor ranges for the theme's numbers. acorn-backend/resume/design.go clamps to the same
 * limits and uses the same defaults, so a value the editor allows always renders.
 */
export const RESUME_THEME_LIMITS = {
  baseSize: { min: 7, max: 16, step: 0.5 },
  nameSize: { min: 14, max: 40, step: 1 },
  titleSize: { min: 8, max: 20, step: 0.5 },
  margin: { min: 0.25, max: 1.5, step: 0.05 },
  sectionGap: { min: 0, max: 36, step: 0.5 },
  entryGap: { min: 0, max: 24, step: 0.5 },
  lineHeight: { min: 1, max: 2, step: 0.02 },
} as const;

export type ResumeLayoutSection = {
  id: string;
  type: ResumeSectionType;
  title: string;
  titleColor: string;
  titleSize: number;
  bodySize: number;
  /** Left off the page but kept in the layout, so it returns in the same place. */
  hidden?: boolean;
};

export type ResumeCoverageSettings = {
  enabled: boolean;
  experienceRequirementThreshold: number;
  aliases: Record<string, string[]>;
};

export type ResumeTemplateSlot = {
  index: number;
  paragraphIndex: number;
  section: ResumePurpose | string;
  companyHint?: string;
  isBullet: boolean;
  experienceIndex?: number;
  token?: string;
  kind?: string;
};

export type UploadedTemplateManifest = {
  id: string;
  name: string;
  source: "uploaded";
  format: "docx";
  fileName?: string;
  slotCount: number;
  sectionsFound: ResumePurpose[];
  slots: ResumeTemplateSlot[];
  warnings: string[];
  uploadedAt?: string;
};

export type ResumeGeneratorConfig = {
  schemaVersion: typeof RESUME_GENERATOR_CONFIG_VERSION;
  provider: ResumeProviderId;
  model: string;
  reasoningEffort: ResumeReasoningEffort;
  dynamicCareerTitles: boolean;
  templateId: string;
  uploadedTemplate?: UploadedTemplateManifest;
  theme: ResumeTheme;
  layout: ResumeLayoutSection[];
  systemInstruction: string;
  jobDescription: string;
  steps: ResumeGenStep[];
  coverage: ResumeCoverageSettings;
};

export const JOB_DESC_TOKEN = "{job_description}";

export const DEFAULT_RESUME_SYSTEM_INSTRUCTION = "You are an expert resume writer.";

export const DEFAULT_RESUME_MODEL = "openai/gpt-6-luna";
export const DEFAULT_RESUME_PROVIDER: ResumeProviderId = "openrouter";

const SECTION_TITLE: Record<ResumeSectionType, string> = {
  summary: "Professional Summary",
  skills: "Skills",
  experience: "Experience",
  education: "Education",
};

let stepSeq = 0;
function uid(): string {
  stepSeq += 1;
  return `rs-${stepSeq.toString(36)}`;
}

export function defaultResumeTheme(): ResumeTheme {
  return {
    font: "Georgia",
    baseSize: 10.5,
    nameSize: 24,
    titleSize: 12,
    accent: "#1f3a5f",
    text: "#1a1a1a",
    headerAlign: "center",
    paper: "letter",
    margin: 0.6,
    sectionGap: 10.5,
    entryGap: 7.5,
    lineHeight: 1.42,
  };
}

export function defaultSchemaFor(purpose: ResumePurpose): string {
  switch (purpose) {
    case "summary":
      return JSON.stringify(
        {
          type: "object",
          properties: { summary: { type: "string" } },
          required: ["summary"],
          additionalProperties: false,
        },
        null,
        2,
      );
    case "skills":
      return JSON.stringify(
        {
          type: "object",
          properties: {
            skills: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  items: { type: "array", items: { type: "string" } },
                },
                required: ["category", "items"],
              },
            },
          },
          required: ["skills"],
          additionalProperties: false,
        },
        null,
        2,
      );
    case "experience":
      return JSON.stringify(
        {
          type: "object",
          properties: {
            experiences: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  company: { type: "string" },
                  title: { type: "string" },
                  period: { type: "string" },
                  bullets: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
                },
                required: ["company", "title", "bullets"],
              },
            },
          },
          required: ["experiences"],
          additionalProperties: false,
        },
        null,
        2,
      );
    default: {
      const exhaustive: never = purpose;
      return exhaustive;
    }
  }
}

function defaultSection(type: ResumeSectionType, theme: ResumeTheme): ResumeLayoutSection {
  return {
    id: uid(),
    type,
    title: SECTION_TITLE[type],
    titleColor: theme.accent,
    titleSize: theme.titleSize,
    bodySize: theme.baseSize,
  };
}

function finalStep(purpose: ResumePurpose): ResumeGenStep {
  return {
    id: uid(),
    purpose,
    kind: "final",
    name: `${RESUME_SECTION_LABEL[purpose]} (final)`,
    prompt: "",
    schema: defaultSchemaFor(purpose),
  };
}

export function defaultResumeConfig(): ResumeGeneratorConfig {
  const theme = defaultResumeTheme();
  return {
    schemaVersion: RESUME_GENERATOR_CONFIG_VERSION,
    provider: DEFAULT_RESUME_PROVIDER,
    model: DEFAULT_RESUME_MODEL,
    reasoningEffort: "low",
    dynamicCareerTitles: false,
    templateId: "classic",
    theme,
    layout: RESUME_SECTION_TYPES.map((type) => defaultSection(type, theme)),
    systemInstruction: DEFAULT_RESUME_SYSTEM_INSTRUCTION,
    jobDescription: "",
    steps: RESUME_PURPOSES.map((purpose) => finalStep(purpose)),
    coverage: {
      enabled: false,
      experienceRequirementThreshold: 4,
      aliases: {},
    },
  };
}

export function ensureResumePurposes(config: ResumeGeneratorConfig): ResumeGeneratorConfig {
  const layout = config.layout.map((section) => (section.id ? section : { ...section, id: uid() }));
  for (const type of RESUME_SECTION_TYPES) {
    if (!layout.some((section) => section.type === type))
      layout.push(defaultSection(type, config.theme));
  }
  const steps = config.steps
    .filter((step) => (RESUME_PURPOSES as string[]).includes(step.purpose))
    .map((step) => (step.id ? step : { ...step, id: uid() }));
  for (const purpose of RESUME_PURPOSES) {
    if (!steps.some((step) => step.purpose === purpose && step.kind === "final")) {
      steps.push(finalStep(purpose));
    }
  }
  return { ...config, layout, steps };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A stored number, where 0 is a real choice (no gap) rather than "unset". */
function finiteOr(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

function migrateTheme(value: unknown, base: ResumeTheme): ResumeTheme {
  const raw = record(value);
  return {
    ...base,
    font: typeof raw.font === "string" && raw.font ? raw.font : base.font,
    baseSize: Number(raw.baseSize ?? raw.bodySizePt) || base.baseSize,
    nameSize: Number(raw.nameSize ?? raw.nameSizePt) || base.nameSize,
    titleSize: Number(raw.titleSize) || base.titleSize,
    accent: String(raw.accent ?? raw.accentColor ?? base.accent),
    text: String(raw.text ?? raw.textColor ?? base.text),
    headerAlign: raw.headerAlign === "left" ? "left" : "center",
    paper: raw.paper === "a4" || raw.paperSize === "a4" ? "a4" : "letter",
    margin: Number(raw.margin ?? raw.marginIn) || base.margin,
    sectionGap: finiteOr(raw.sectionGap, base.sectionGap),
    entryGap: finiteOr(raw.entryGap, base.entryGap),
    lineHeight: Number(raw.lineHeight) || base.lineHeight,
  };
}

function migrateLayout(
  raw: Record<string, unknown>,
  theme: ResumeTheme,
  base: ResumeLayoutSection[],
): ResumeLayoutSection[] {
  if (Array.isArray(raw.layout) && raw.layout.length) return raw.layout as ResumeLayoutSection[];
  if (!Array.isArray(raw.sections) || !raw.sections.length) return base;
  return raw.sections
    .map(record)
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
    .map((section, index) => {
      const type = String(section.type ?? section.id ?? "") as ResumeSectionType;
      if (!RESUME_SECTION_TYPES.includes(type)) return null;
      return {
        id: String(section.id ?? `${type}-${index}`),
        type,
        title: String(section.title ?? RESUME_SECTION_LABEL[type]),
        titleColor: String(section.titleColor ?? section.color ?? theme.accent),
        titleSize: Number(section.titleSize ?? section.titleSizePt) || theme.titleSize,
        bodySize: Number(section.bodySize ?? section.bodySizePt) || theme.baseSize,
      } satisfies ResumeLayoutSection;
    })
    .filter((section): section is ResumeLayoutSection => section != null);
}

function asUploadedTemplate(value: unknown): UploadedTemplateManifest | undefined {
  const raw = record(value);
  if (typeof raw.id !== "string" || !raw.id) return undefined;
  const sections = Array.isArray(raw.sectionsFound)
    ? raw.sectionsFound.filter((item): item is ResumePurpose =>
        (RESUME_PURPOSES as string[]).includes(String(item)),
      )
    : [];
  return {
    id: raw.id,
    name: String(raw.name ?? "Uploaded template"),
    source: "uploaded",
    format: "docx",
    fileName: typeof raw.fileName === "string" ? raw.fileName : undefined,
    slotCount: Number(raw.slotCount) || 0,
    sectionsFound: sections,
    slots: Array.isArray(raw.slots) ? (raw.slots as ResumeTemplateSlot[]) : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
    uploadedAt: typeof raw.uploadedAt === "string" ? raw.uploadedAt : undefined,
  };
}

/** Merge stored JSON onto defaults. Job description stays off the persisted config. */
export function mergeStoredResumeConfig(parsed: unknown): ResumeGeneratorConfig {
  const base = defaultResumeConfig();
  const envelope = record(parsed);
  const raw =
    envelope.settings || envelope.presentation
      ? { ...record(envelope.settings), ...record(envelope.presentation) }
      : envelope;
  const theme = migrateTheme(raw.theme, base.theme);
  const savedSteps = Array.isArray(raw.steps)
    ? raw.steps
    : Array.isArray(raw.refinementSteps)
      ? raw.refinementSteps
      : [];
  return ensureResumePurposes({
    schemaVersion: RESUME_GENERATOR_CONFIG_VERSION,
    provider: DEFAULT_RESUME_PROVIDER,
    model: DEFAULT_RESUME_MODEL,
    reasoningEffort:
      typeof raw.reasoningEffort === "string"
        ? (raw.reasoningEffort as ResumeReasoningEffort)
        : base.reasoningEffort,
    dynamicCareerTitles: raw.dynamicCareerTitles === true,
    templateId: typeof raw.templateId === "string" ? raw.templateId : base.templateId,
    uploadedTemplate: asUploadedTemplate(raw.uploadedTemplate),
    theme,
    layout: migrateLayout(raw, theme, base.layout),
    systemInstruction:
      typeof raw.systemInstruction === "string" ? raw.systemInstruction : base.systemInstruction,
    jobDescription: typeof raw.jobDescription === "string" ? raw.jobDescription : "",
    steps: savedSteps.length
      ? savedSteps.map((step) => {
          const row = record(step);
          return {
            id: String(row.id || uid()),
            purpose: (RESUME_PURPOSES as string[]).includes(String(row.purpose))
              ? (row.purpose as ResumePurpose)
              : "summary",
            kind: row.kind === "fine-tune" ? "fine-tune" : "final",
            name: String(row.name ?? ""),
            prompt: String(row.prompt ?? ""),
            schema: String(row.schema ?? ""),
          };
        })
      : base.steps,
    coverage: {
      enabled: false,
      experienceRequirementThreshold: 4,
      aliases: {},
    },
  });
}

export function serializeStoredResumeConfig(config: ResumeGeneratorConfig): Omit<
  ResumeGeneratorConfig,
  "jobDescription"
> & {
  schemaVersion: typeof RESUME_GENERATOR_CONFIG_VERSION;
} {
  const { jobDescription: _jobDescription, ...stored } = config;
  return { ...stored, schemaVersion: RESUME_GENERATOR_CONFIG_VERSION };
}
