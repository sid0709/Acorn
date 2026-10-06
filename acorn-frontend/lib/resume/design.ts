import { RESUME_PALETTES } from "@acorn/shared/resume-fonts";
import type { ResumeGeneratorConfig } from "@acorn/shared/resume-config";
import { isUploadedTemplateId, resumeTemplateById } from "@acorn/shared/resume-templates";

/** Template every uploaded DOCX falls back to when a layout is needed. */
export const FALLBACK_TEMPLATE_ID = "classic";

/** Wait after the last design change before asking the server for a new preview. */
export const PREVIEW_DEBOUNCE_MS = 250;

/** The config with a template picked: its own font, accent, and header alignment come along. */
export function withTemplate(config: ResumeGeneratorConfig, id: string): ResumeGeneratorConfig {
  const picked = resumeTemplateById(isUploadedTemplateId(id) ? FALLBACK_TEMPLATE_ID : id);
  const keepTheme = isUploadedTemplateId(id);
  return {
    ...config,
    templateId: id,
    theme: keepTheme
      ? config.theme
      : {
          ...config.theme,
          font: picked.defaults?.font ?? config.theme.font,
          accent: picked.defaults?.accent ?? config.theme.accent,
          headerAlign: picked.defaultHeaderAlign,
        },
  };
}

export function withPalette(config: ResumeGeneratorConfig, name: string): ResumeGeneratorConfig {
  const palette = RESUME_PALETTES.find((item) => item.name === name);
  if (!palette) return config;
  return { ...config, theme: { ...config.theme, accent: palette.accent, text: palette.text } };
}

/** The palette whose accent the theme uses, if it matches one. */
export function paletteName(config: ResumeGeneratorConfig): string | undefined {
  return RESUME_PALETTES.find((item) => item.accent === config.theme.accent)?.name;
}
