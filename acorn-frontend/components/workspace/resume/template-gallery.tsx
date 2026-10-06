"use client";

import {
  Badge,
  Button,
  Dialog,
  DialogHeader,
  FileUploader,
  Glyph,
  HStack,
  IconButton,
  Layout,
  LayoutContent,
  SelectableCard,
  Skeleton,
  Stack,
  Text,
} from "sid-ui";
import { RESUME_TEMPLATE_ACCEPT, RESUME_TEMPLATE_MAX_BYTES } from "@acorn/shared/resume-library";
import { RESUME_TEMPLATES, uploadedTemplateId } from "@acorn/shared/resume-templates";
import { PaperFrame } from "./paper-frame";

const GALLERY_WIDTH = 960;

export type UploadedTemplate = { id: string; name: string; warnings: string[] };

/** Every built-in layout as a real thumbnail, plus the person's own DOCX templates. */
export function TemplateGallery({
  isOpen,
  onOpenChange,
  selectedId,
  thumbs,
  uploads,
  uploading,
  onSelect,
  onUpload,
  onRemoveUpload,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId: string;
  thumbs: Record<string, string>;
  uploads: UploadedTemplate[];
  uploading: boolean;
  onSelect: (id: string) => void;
  onUpload: (files: File[]) => void;
  onRemoveUpload: (id: string) => void;
}) {
  const pick = (id: string) => {
    onSelect(id);
    onOpenChange(false);
  };

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={GALLERY_WIDTH}>
      <Layout
        height="auto"
        header={
          <DialogHeader
            title="Choose a template"
            subtitle="Shown with sample text and your header. Picking one brings its font and accent."
            onOpenChange={onOpenChange}
            hasDivider
          />
        }
        content={
          <LayoutContent>
            <Stack gap={6}>
              <div className="resume-template-grid">
                {RESUME_TEMPLATES.map((template) => (
                  <SelectableCard
                    key={template.id}
                    label={template.name}
                    isSelected={selectedId === template.id}
                    onChange={() => pick(template.id)}
                    padding={2}
                  >
                    <Stack gap={2}>
                      {thumbs[template.id] ? (
                        <PaperFrame
                          html={thumbs[template.id]}
                          title={`${template.name} template`}
                          variant="thumb"
                        />
                      ) : (
                        <div className="resume-thumb-slot">
                          <Skeleton height="100%" radius={2} />
                        </div>
                      )}
                      <Stack gap={0}>
                        <Text weight="semibold">{template.name}</Text>
                        <Text type="supporting" color="secondary">
                          {template.blurb}
                        </Text>
                      </Stack>
                    </Stack>
                  </SelectableCard>
                ))}
              </div>
              <Stack gap={3}>
                <Stack gap={1}>
                  <Text weight="semibold">Your Word templates</Text>
                  <Text type="supporting" color="secondary">
                    A .docx with {"{summary}"}, {"{skills}"}, {"{title1}"}, and {"{experience1}"}.
                    Name, companies, dates, and education stay as you wrote them.
                  </Text>
                </Stack>
                {uploads.map((item) => {
                  const id = uploadedTemplateId(item.id);
                  const active = selectedId === id;
                  return (
                    <HStack key={item.id} gap={2} vAlign="center" hAlign="between" wrap="wrap">
                      <HStack gap={2} vAlign="center">
                        <Glyph name="file" />
                        <Text weight="semibold">{item.name}</Text>
                        <Badge label="DOCX" variant="blue" />
                        {item.warnings.length ? (
                          <Badge
                            label={`${item.warnings.length} warning${item.warnings.length === 1 ? "" : "s"}`}
                            variant="warning"
                          />
                        ) : null}
                      </HStack>
                      <HStack gap={1} vAlign="center">
                        <Button
                          label={active ? "In use" : "Use"}
                          variant={active ? "secondary" : "ghost"}
                          size="sm"
                          isDisabled={active}
                          onClick={() => pick(id)}
                        />
                        <IconButton
                          label={`Remove ${item.name}`}
                          icon={<Glyph name="trash" />}
                          variant="ghost"
                          size="sm"
                          onClick={() => onRemoveUpload(item.id)}
                        />
                      </HStack>
                    </HStack>
                  );
                })}
                <FileUploader
                  label="Upload a DOCX template"
                  variant="compact"
                  accept={RESUME_TEMPLATE_ACCEPT}
                  maxSize={RESUME_TEMPLATE_MAX_BYTES}
                  maxFiles={1}
                  isDisabled={uploading}
                  onChange={onUpload}
                />
              </Stack>
            </Stack>
          </LayoutContent>
        }
      />
    </Dialog>
  );
}
