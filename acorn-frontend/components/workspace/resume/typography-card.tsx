"use client";

import { SectionCard, Slider, Stack, Text } from "sid-ui";
import { withThemeValue } from "@/lib/resume/design";
import {
  RESUME_THEME_LIMITS,
  type ResumeGeneratorConfig,
  type ResumeTheme,
} from "@acorn/shared/resume-config";

type NumericKey = keyof typeof RESUME_THEME_LIMITS & keyof ResumeTheme;

const points = (value: number) => `${value} pt`;

/** Groups of sliders, top to bottom: text sizes, then page spacing. */
const GROUPS: {
  title: string;
  rows: { key: NumericKey; label: string; format: (v: number) => string; hint?: string }[];
}[] = [
  {
    title: "Text",
    rows: [
      { key: "nameSize", label: "Name", format: points },
      { key: "titleSize", label: "Section headings", format: points, hint: "Sets every section." },
      { key: "baseSize", label: "Body", format: points, hint: "Sets every section." },
      { key: "lineHeight", label: "Line height", format: (v) => v.toFixed(2) },
    ],
  },
  {
    title: "Spacing",
    rows: [
      { key: "sectionGap", label: "Between sections", format: points },
      { key: "entryGap", label: "Between roles", format: points },
      { key: "margin", label: "Page margin", format: (v) => `${v.toFixed(2)} in` },
    ],
  },
];

/** Sizes and spacing for the whole page. Sections can still override their own sizes. */
export function TypographyCard({
  config,
  onChange,
}: {
  config: ResumeGeneratorConfig;
  onChange: (next: ResumeGeneratorConfig) => void;
}) {
  return (
    <SectionCard
      title="Typography & spacing"
      description="Tighten a long résumé onto one page, or open up a short one."
    >
      <Stack gap={5}>
        {GROUPS.map((group) => (
          <Stack key={group.title} gap={3}>
            <Text type="label" color="secondary">
              {group.title}
            </Text>
            {group.rows.map((row) => (
              <Slider
                key={row.key}
                label={row.label}
                description={row.hint}
                value={config.theme[row.key]}
                {...RESUME_THEME_LIMITS[row.key]}
                valueDisplay="text"
                formatValue={row.format}
                onChange={(value: number) => onChange(withThemeValue(config, row.key, value))}
              />
            ))}
          </Stack>
        ))}
      </Stack>
    </SectionCard>
  );
}
