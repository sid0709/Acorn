import { RESUME_MONO_FONT } from "./resume-templates";

/** Font names the editor can pick. Google families load from the stylesheet; system names do not. */

export const RESUME_GOOGLE_FONTS = [
  "Inter",
  "Source Sans 3",
  "Roboto",
  "Open Sans",
  "Lato",
  "Source Serif 4",
  "Merriweather",
  "Lora",
  "PT Serif",
  "Roboto Mono",
  "JetBrains Mono",
] as const;

export const RESUME_SYSTEM_FONTS = [
  "Georgia",
  "Times New Roman",
  "Garamond",
  "Cambria",
  "Arial",
  "Helvetica",
  "Calibri",
] as const;

export type ResumeFontOption = {
  value: string;
  label: string;
  kind: "google" | "system" | "mono";
};

const SERIF_FONTS = new Set([
  "Georgia",
  "Times New Roman",
  "Garamond",
  "Cambria",
  "Source Serif 4",
  "Merriweather",
  "Lora",
  "PT Serif",
]);
const MONO_FONTS = new Set(["Roboto Mono", "JetBrains Mono"]);

export const RESUME_FONT_OPTIONS: ResumeFontOption[] = [
  ...RESUME_GOOGLE_FONTS.filter((name) => !MONO_FONTS.has(name)).map((name) => ({
    value: name,
    label: name,
    kind: "google" as const,
  })),
  ...RESUME_SYSTEM_FONTS.map((name) => ({
    value: name,
    label: `${name} (system)`,
    kind: "system" as const,
  })),
  { value: "Roboto Mono", label: "Roboto Mono", kind: "google" },
  { value: "JetBrains Mono", label: "JetBrains Mono", kind: "google" },
  { value: RESUME_MONO_FONT, label: "Monospace (system)", kind: "mono" },
];

/** CSS font-family for a chosen name. Stacks already containing a comma pass through. */
export function resumeFontStack(name: string): string {
  if (!name) return "sans-serif";
  if (name.includes(",")) return name;
  const generic = MONO_FONTS.has(name)
    ? "monospace"
    : SERIF_FONTS.has(name)
      ? "serif"
      : "sans-serif";
  const quoted = /\s/.test(name) ? `"${name}"` : name;
  return `${quoted}, ${generic}`;
}

/** Same families and weights as acorn-backend/resume/fonts.go, which renders the preview. */
export const RESUME_GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Sans+3:wght@400;600;700&family=Roboto:wght@400;500;700&family=Open+Sans:wght@400;600;700&family=Lato:wght@400;700&family=Source+Serif+4:wght@400;600;700&family=Merriweather:wght@400;700&family=Lora:wght@400;600;700&family=PT+Serif:wght@400;700&family=Roboto+Mono:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap";

export const RESUME_PALETTES: { name: string; accent: string; text: string }[] = [
  { name: "Navy", accent: "#1f3a5f", text: "#1a1a1a" },
  { name: "Emerald", accent: "#0f766e", text: "#111827" },
  { name: "Burgundy", accent: "#7b1e3b", text: "#1a1a1a" },
  { name: "Royal", accent: "#4338ca", text: "#1f2937" },
  { name: "Slate", accent: "#334155", text: "#0f172a" },
  { name: "Teal", accent: "#0e7490", text: "#0f172a" },
  { name: "Plum", accent: "#6d28d9", text: "#1f2937" },
  { name: "Charcoal", accent: "#111827", text: "#111827" },
];
