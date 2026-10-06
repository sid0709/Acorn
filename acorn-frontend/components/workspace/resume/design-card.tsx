"use client";

import {
  Button,
  Glyph,
  HStack,
  SectionCard,
  SegmentedControl,
  SegmentedControlItem,
  Selector,
  Stack,
  Text,
  ToggleButton,
} from "sid-ui";
import { paletteName, withPalette } from "@/lib/resume/design";
import type { ResumeGeneratorConfig, ResumeTheme } from "@acorn/shared/resume-config";
import { RESUME_FONT_OPTIONS, RESUME_PALETTES } from "@acorn/shared/resume-fonts";
import { isUploadedTemplateId } from "@acorn/shared/resume-templates";

/** A dot in the palette's accent. The color is document data from the palette list, not app chrome. */
function Swatch({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true">
      <circle cx="8" cy="8" r="8" fill={color} />
    </svg>
  );
}

/** Template, type, color, and page setup. Every change shows up in the live preview. */
export function DesignCard({
  config,
  templateName,
  templateBlurb,
  onChange,
  onBrowse,
}: {
  config: ResumeGeneratorConfig;
  templateName: string;
  templateBlurb: string;
  onChange: (next: ResumeGeneratorConfig) => void;
  onBrowse: () => void;
}) {
  const uploaded = isUploadedTemplateId(config.templateId);
  const activePalette = paletteName(config);
  const setTheme = (patch: Partial<ResumeTheme>) =>
    onChange({ ...config, theme: { ...config.theme, ...patch } });

  return (
    <SectionCard title="Design" description="Changes show in the preview as you make them.">
      <Stack gap={4}>
        <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
          <Stack gap={0}>
            <Text type="label" color="secondary">
              Template
            </Text>
            <Text weight="semibold">{templateName}</Text>
            <Text type="supporting" color="secondary">
              {templateBlurb}
            </Text>
          </Stack>
          <Button
            label="Browse templates"
            variant="secondary"
            icon={<Glyph name="grid" />}
            onClick={onBrowse}
          />
        </HStack>
        {uploaded ? (
          <Text type="supporting" color="secondary">
            Word templates keep their own fonts and colors. Export the draft to see the exact file.
          </Text>
        ) : (
          <>
            <Selector
              label="Font"
              value={config.theme.font}
              options={RESUME_FONT_OPTIONS.map((font) => ({
                value: font.value,
                label: font.label,
              }))}
              onChange={(font) => setTheme({ font })}
            />
            <Stack gap={2}>
              <Text type="label">{`Color · ${activePalette ?? "Custom"}`}</Text>
              <HStack gap={1} wrap="wrap">
                {RESUME_PALETTES.map((palette) => (
                  <ToggleButton
                    key={palette.name}
                    label={palette.name}
                    tooltip={palette.name}
                    icon={<Swatch color={palette.accent} />}
                    isIconOnly
                    isPressed={palette.name === activePalette}
                    onPressedChange={() => onChange(withPalette(config, palette.name))}
                  />
                ))}
              </HStack>
            </Stack>
            <HStack gap={4} wrap="wrap">
              <Stack gap={2}>
                <Text type="label">Header</Text>
                <SegmentedControl
                  label="Header"
                  value={config.theme.headerAlign}
                  onChange={(value) =>
                    setTheme({ headerAlign: value as ResumeTheme["headerAlign"] })
                  }
                >
                  <SegmentedControlItem value="left" label="Left" />
                  <SegmentedControlItem value="center" label="Center" />
                </SegmentedControl>
              </Stack>
              <Stack gap={2}>
                <Text type="label">Paper</Text>
                <SegmentedControl
                  label="Paper"
                  value={config.theme.paper}
                  onChange={(value) => setTheme({ paper: value as ResumeTheme["paper"] })}
                >
                  <SegmentedControlItem value="letter" label="Letter" />
                  <SegmentedControlItem value="a4" label="A4" />
                </SegmentedControl>
              </Stack>
            </HStack>
          </>
        )}
      </Stack>
    </SectionCard>
  );
}
