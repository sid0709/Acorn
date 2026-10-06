import { RESUME_PALETTES } from "@acorn/shared/resume-fonts";
import type {
  ResumeGeneratorConfig,
  ResumeLayoutSection,
  ResumeTheme,
} from "@acorn/shared/resume-config";
import { isUploadedTemplateId, resumeTemplateById } from "@acorn/shared/resume-templates";

/** Template every uploaded DOCX falls back to when a layout is needed. */
export const FALLBACK_TEMPLATE_ID = "classic";

/** Wait after the last design change before asking the server for a new preview. */
export const PREVIEW_DEBOUNCE_MS = 250;

/** The config with a template picked: its own font, accent, and header alignment come along. */
export function withTemplate(config: ResumeGeneratorConfig, id: string): ResumeGeneratorConfig {
  if (isUploadedTemplateId(id)) return { ...config, templateId: id };
  const picked = resumeTemplateById(id);
  const next = withAccent(config, picked.defaults?.accent ?? config.theme.accent);
  return {
    ...next,
    templateId: id,
    theme: {
      ...next.theme,
      font: picked.defaults?.font ?? config.theme.font,
      headerAlign: picked.defaultHeaderAlign,
    },
  };
}

/** New accent (and text color). Headings that followed the old accent follow the new one. */
export function withAccent(
  config: ResumeGeneratorConfig,
  accent: string,
  text = config.theme.text,
): ResumeGeneratorConfig {
  const previous = config.theme.accent;
  return {
    ...config,
    theme: { ...config.theme, accent, text },
    layout: config.layout.map((section) =>
      section.titleColor === previous ? { ...section, titleColor: accent } : section,
    ),
  };
}

/** Theme sizes that every section also carries; setting one resets the per-section overrides. */
const SECTION_SIZE: Partial<Record<keyof ResumeTheme, keyof ResumeLayoutSection>> = {
  titleSize: "titleSize",
  baseSize: "bodySize",
};

export function withThemeValue<K extends keyof ResumeTheme>(
  config: ResumeGeneratorConfig,
  key: K,
  value: ResumeTheme[K],
): ResumeGeneratorConfig {
  const sectionKey = SECTION_SIZE[key];
  return {
    ...config,
    theme: { ...config.theme, [key]: value },
    layout: sectionKey
      ? config.layout.map((section) => ({ ...section, [sectionKey]: value }))
      : config.layout,
  };
}

export function withSection(
  config: ResumeGeneratorConfig,
  id: string,
  patch: Partial<ResumeLayoutSection>,
): ResumeGeneratorConfig {
  return {
    ...config,
    layout: config.layout.map((section) =>
      section.id === id ? { ...section, ...patch } : section,
    ),
  };
}

/** Swap a section with its neighbor; `-1` moves it up the page. */
export function withSectionMoved(
  config: ResumeGeneratorConfig,
  id: string,
  direction: -1 | 1,
): ResumeGeneratorConfig {
  const layout = [...config.layout];
  const from = layout.findIndex((section) => section.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= layout.length) return config;
  [layout[from], layout[to]] = [layout[to], layout[from]];
  return { ...config, layout };
}

export function withPalette(config: ResumeGeneratorConfig, name: string): ResumeGeneratorConfig {
  const palette = RESUME_PALETTES.find((item) => item.name === name);
  if (!palette) return config;
  return withAccent(config, palette.accent, palette.text);
}

/** The palette whose accent the theme uses, if it matches one. */
export function paletteName(config: ResumeGeneratorConfig): string | undefined {
  return RESUME_PALETTES.find((item) => item.accent === config.theme.accent)?.name;
}
