"use client";

import { Badge, Button, Glyph, HStack, SectionCard, Skeleton, Stack, Text } from "sid-ui";
import { PaperFrame } from "./paper-frame";

export type PreviewStage = "sample" | "writing" | "ready";

const STAGE_BADGE: Record<
  PreviewStage,
  { label: string; variant: "neutral" | "info" | "success" }
> = {
  sample: { label: "Sample text", variant: "neutral" },
  writing: { label: "Writing…", variant: "info" },
  ready: { label: "Your draft", variant: "success" },
};

const STAGE_HINT: Record<PreviewStage, string> = {
  sample: "Your header and roles with sample text. Generate to write it for the posting.",
  writing: "Sections fill in as the model writes them.",
  ready: "Change the design and the draft re-lays out. Download the Word file when it looks right.",
};

/** The page as it will print, kept in view while the controls beside it change. */
export function LivePreview({
  html,
  stage,
  paperLabel,
  downloading,
  onDownload,
}: {
  html: string;
  stage: PreviewStage;
  paperLabel: string;
  downloading: boolean;
  onDownload?: () => void;
}) {
  const badge = STAGE_BADGE[stage];
  return (
    <SectionCard
      title="Live preview"
      description={paperLabel}
      action={
        <HStack gap={2} vAlign="center">
          <Badge label={badge.label} variant={badge.variant} />
          {onDownload ? (
            <Button
              label="Download .docx"
              variant="primary"
              size="sm"
              icon={<Glyph name="download" />}
              isLoading={downloading}
              onClick={onDownload}
            />
          ) : null}
        </HStack>
      }
    >
      <Stack gap={2}>
        {html ? (
          <PaperFrame html={html} title="Résumé preview" />
        ) : (
          <div className="resume-thumb-slot">
            <Skeleton height="100%" radius={2} />
          </div>
        )}
        <Text type="supporting" color="secondary">
          {STAGE_HINT[stage]}
        </Text>
      </Stack>
    </SectionCard>
  );
}
