"use client";

import {
  Collapsible,
  Glyph,
  HStack,
  IconButton,
  NumberInput,
  SectionCard,
  Stack,
  Switch,
  Text,
  TextInput,
  ToggleButton,
} from "sid-ui";
import { withSection, withSectionMoved } from "@/lib/resume/design";
import {
  RESUME_THEME_LIMITS,
  type ResumeGeneratorConfig,
  type ResumeLayoutSection,
} from "@acorn/shared/resume-config";
import { RESUME_PALETTES } from "@acorn/shared/resume-fonts";
import { RESUME_SECTION_LABEL, resumeTemplateById } from "@acorn/shared/resume-templates";
import { Swatch } from "./swatch";

const SECTION_TITLE_MAX = 40;

/** Order, visibility, heading text, color, and sizes for each section on the page. */
export function SectionsCard({
  config,
  onChange,
}: {
  config: ResumeGeneratorConfig;
  onChange: (next: ResumeGeneratorConfig) => void;
}) {
  const template = resumeTemplateById(config.templateId);
  const patch = (id: string, next: Partial<ResumeLayoutSection>) =>
    onChange(withSection(config, id, next));
  const colors = [
    { name: "Theme accent", value: config.theme.accent },
    ...RESUME_PALETTES.filter((palette) => palette.accent !== config.theme.accent).map(
      (palette) => ({ name: palette.name, value: palette.accent }),
    ),
  ];

  return (
    <SectionCard
      title="Sections"
      description={
        template.columns === 2
          ? "Order applies within each column. This template keeps skills and education in the sidebar."
          : "Top to bottom, the way they print."
      }
    >
      <Stack gap={3}>
        {config.layout.map((section, index) => {
          const label = RESUME_SECTION_LABEL[section.type];
          const shown = !section.hidden;
          return (
            <Stack key={section.id} gap={2}>
              <HStack gap={2} vAlign="center" hAlign="between">
                <HStack gap={2} vAlign="center">
                  <Switch
                    label={`Show ${label}`}
                    isLabelHidden
                    size="sm"
                    value={shown}
                    onChange={(checked) => patch(section.id, { hidden: !checked })}
                  />
                  <Stack gap={0}>
                    <Text weight="semibold" color={shown ? undefined : "secondary"}>
                      {section.title || label}
                    </Text>
                    {section.title && section.title !== label ? (
                      <Text type="supporting" color="secondary">
                        {label}
                      </Text>
                    ) : null}
                  </Stack>
                </HStack>
                <HStack gap={1}>
                  <IconButton
                    label={`Move ${label} up`}
                    icon={<Glyph name="arrowUp" />}
                    variant="ghost"
                    size="sm"
                    isDisabled={index === 0}
                    onClick={() => onChange(withSectionMoved(config, section.id, -1))}
                  />
                  <IconButton
                    label={`Move ${label} down`}
                    icon={<Glyph name="arrowDown" />}
                    variant="ghost"
                    size="sm"
                    isDisabled={index === config.layout.length - 1}
                    onClick={() => onChange(withSectionMoved(config, section.id, 1))}
                  />
                </HStack>
              </HStack>
              {shown ? (
                <Collapsible
                  defaultIsOpen={false}
                  trigger={
                    <Text type="supporting" color="secondary">
                      Customize
                    </Text>
                  }
                >
                  <Stack gap={3}>
                    <TextInput
                      label="Heading"
                      value={section.title}
                      placeholder={label}
                      onChange={(title) =>
                        patch(section.id, { title: title.slice(0, SECTION_TITLE_MAX) })
                      }
                    />
                    <HStack gap={3} wrap="wrap">
                      <NumberInput
                        label="Heading size"
                        units="pt"
                        value={section.titleSize}
                        {...RESUME_THEME_LIMITS.titleSize}
                        onChange={(titleSize) => patch(section.id, { titleSize })}
                      />
                      <NumberInput
                        label="Body size"
                        units="pt"
                        value={section.bodySize}
                        {...RESUME_THEME_LIMITS.baseSize}
                        onChange={(bodySize) => patch(section.id, { bodySize })}
                      />
                    </HStack>
                    <Stack gap={2}>
                      <Text type="label">Heading color</Text>
                      <HStack gap={1} wrap="wrap">
                        {colors.map((color) => (
                          <ToggleButton
                            key={color.name}
                            label={color.name}
                            tooltip={color.name}
                            icon={<Swatch color={color.value} />}
                            isIconOnly
                            size="sm"
                            isPressed={section.titleColor === color.value}
                            onPressedChange={() => patch(section.id, { titleColor: color.value })}
                          />
                        ))}
                      </HStack>
                    </Stack>
                  </Stack>
                </Collapsible>
              ) : null}
            </Stack>
          );
        })}
      </Stack>
    </SectionCard>
  );
}
