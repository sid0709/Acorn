import { RESUME_GENERATOR_CONFIG_VERSION } from '../constants/generator.constants';
import {
  defaultGeneratorConfig,
  type GeneratorConfig,
} from './default-generator-config';
import { cleanString } from './clean-string';

export const DEFAULT_COVERAGE_SETTINGS = Object.freeze({
  enabled: false,
  experienceRequirementThreshold: 4,
  aliases: {},
});

function normalizeAliases(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const aliases: Record<string, string[]> = {};
  for (const [rawName, rawValues] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const name = cleanString(rawName);
    if (!name || !Array.isArray(rawValues)) continue;
    const values = [
      ...new Set(rawValues.map(cleanString).filter(Boolean)),
    ].slice(0, 20);
    if (values.length) aliases[name] = values;
  }
  return aliases;
}

export function normalizeCoverageSettings(value: unknown) {
  const raw =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  return {
    enabled: false,
    experienceRequirementThreshold: 4,
    aliases: normalizeAliases(raw.aliases),
  };
}

type Theme = GeneratorConfig['theme'];
type LayoutSection = GeneratorConfig['layout'][number];

function legacyTheme(theme: unknown, base: Theme): Theme {
  if (!theme || typeof theme !== 'object') return base;
  const t = theme as Record<string, unknown>;
  return {
    ...base,
    font: cleanString(t.font) || base.font,
    baseSize: Number(t.baseSize ?? t.bodySizePt) || base.baseSize,
    nameSize: Number(t.nameSize ?? t.nameSizePt) || base.nameSize,
    titleSize: Number(t.titleSize) || base.titleSize,
    accent: cleanString(t.accent ?? t.accentColor) || base.accent,
    text: cleanString(t.text ?? t.textColor) || base.text,
    headerAlign: t.headerAlign === 'left' ? 'left' : base.headerAlign,
    paper: t.paper === 'a4' || t.paperSize === 'a4' ? 'a4' : base.paper,
    margin: Number(t.margin ?? t.marginIn) || base.margin,
  };
}

function legacyLayout(
  saved: Record<string, unknown>,
  theme: Theme,
  base: LayoutSection[],
): LayoutSection[] {
  if (Array.isArray(saved.layout) && saved.layout.length) {
    return saved.layout as LayoutSection[];
  }
  if (!Array.isArray(saved.sections) || !saved.sections.length) return base;
  const titleByType: Record<string, string> = {
    summary: 'Professional Summary',
    skills: 'Skills',
    experience: 'Experience',
    education: 'Education',
  };
  return [...(saved.sections as Record<string, unknown>[])]
    .sort((left, right) => Number(left?.order ?? 0) - Number(right?.order ?? 0))
    .map((section, index) => {
      const type = cleanString(section?.type ?? section?.id);
      if (!Object.hasOwn(titleByType, type)) return null;
      return {
        id: cleanString(section?.id) || `${type}-${index}`,
        type,
        title: cleanString(section?.title) || titleByType[type],
        titleColor:
          cleanString(section?.titleColor ?? section?.color) || theme.accent,
        titleSize:
          Number(section?.titleSize ?? section?.titleSizePt) || theme.titleSize,
        bodySize:
          Number(section?.bodySize ?? section?.bodySizePt) || theme.baseSize,
      };
    })
    .filter(Boolean) as LayoutSection[];
}

function stepList(
  saved: Record<string, unknown>,
  base: GeneratorConfig['steps'],
) {
  const source =
    Array.isArray(saved.steps) && saved.steps.length
      ? saved.steps
      : Array.isArray(saved.refinementSteps) && saved.refinementSteps.length
        ? saved.refinementSteps
        : base;
  return (source as Record<string, unknown>[]).map((step, index) => ({
    ...step,
    id: cleanString(step?.id) || `migrated-step-${index + 1}`,
    name: cleanString(step?.name) || `Step ${index + 1}`,
    prompt: String(step?.prompt ?? ''),
    schema:
      typeof step?.schema === 'string'
        ? step.schema
        : step?.schema && typeof step.schema === 'object'
          ? JSON.stringify(step.schema, null, 2)
          : '',
  })) as GeneratorConfig['steps'];
}

/**
 * Convert every historical Resume Generator shape into the canonical v4
 * persistence shape. Job descriptions and generated documents intentionally
 * do not belong here; they are ApplicationRun data.
 */
export function migrateGeneratorConfig(saved: unknown) {
  const raw =
    saved && typeof saved === 'object'
      ? (saved as Record<string, unknown>)
      : {};
  const flattened =
    raw.settings || raw.presentation
      ? {
          ...((raw.settings as Record<string, unknown>) || {}),
          ...((raw.presentation as Record<string, unknown>) || {}),
          schemaVersion: raw.schemaVersion,
        }
      : raw;
  const base = defaultGeneratorConfig();
  const theme = legacyTheme(flattened.theme, base.theme);
  const config = {
    schemaVersion: RESUME_GENERATOR_CONFIG_VERSION,
    provider: flattened.provider === 'deepseek' ? 'deepseek' : 'openai',
    model: cleanString(flattened.model) || base.model,
    reasoningEffort:
      cleanString(flattened.reasoningEffort) || base.reasoningEffort,
    dynamicCareerTitles: flattened.dynamicCareerTitles === true,
    templateId: cleanString(flattened.templateId) || base.templateId,
    ...(flattened.uploadedTemplate &&
    typeof flattened.uploadedTemplate === 'object'
      ? {
          uploadedTemplate: flattened.uploadedTemplate as Record<
            string,
            unknown
          >,
        }
      : {}),
    theme,
    layout: legacyLayout(flattened, theme, base.layout),
    systemInstruction:
      typeof flattened.systemInstruction === 'string'
        ? flattened.systemInstruction
        : base.systemInstruction,
    steps: stepList(flattened, base.steps),
    coverage: normalizeCoverageSettings(flattened.coverage),
  };
  const sourceVersion =
    Number(raw.schemaVersion) || (raw.refinementSteps || raw.document ? 2 : 1);
  const canonicalInput =
    sourceVersion === RESUME_GENERATOR_CONFIG_VERSION &&
    !Object.hasOwn(raw, 'jobDescription') &&
    !Object.hasOwn(raw, 'document') &&
    !Object.hasOwn(raw, 'refinementSteps') &&
    !raw.settings &&
    !raw.presentation;
  return {
    config,
    migrated: !canonicalInput || JSON.stringify(raw) !== JSON.stringify(config),
    sourceVersion,
    legacyJobDescription: cleanString(raw.jobDescription) || null,
  };
}

export function isCanonicalGeneratorConfig(value: unknown): boolean {
  return migrateGeneratorConfig(value).migrated === false;
}
