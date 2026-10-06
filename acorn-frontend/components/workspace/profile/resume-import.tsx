"use client";

import { useState } from "react";
import {
  Badge,
  Card,
  FileUploader,
  Glyph,
  HStack,
  Heading,
  Stack,
  Text,
  Token,
  formatBytes,
} from "sid-ui";
import { fillProfileFromResume, type ResumeReader } from "@/lib/profile/api";
import { withDefaults, type ApplicantProfile } from "@/lib/workspace/profile";
import { filledLabels } from "@/lib/workspace/resume-fill";
import { RESUME_ACCEPT, RESUME_MAX_BYTES, resumeUpload } from "@/lib/workspace/resume-file";

/** Progress the uploader shows while a résumé is read, then filled. */
const READ_PROGRESS = 20;
const FILL_PROGRESS = 55;
const DONE_PROGRESS = 100;

const UNREADABLE =
  "Couldn’t find text in that file. Use a PDF with selectable text, a .docx, or a .txt file.";

const READER_NOTE: Record<ResumeReader, string> = {
  ai: "Read by AI",
  layout: "Read from the layout — the AI model isn’t configured",
};

type Filled = { fileName: string; reader: ResumeReader; labels: string[] };

/**
 * Drop a résumé and the profile fills itself: name, contact, location, links,
 * every role with its highlights, and education. The result is saved.
 */
export function ResumeImport({
  profile,
  onFilled,
}: {
  profile: ApplicantProfile;
  onFilled: (next: ApplicantProfile) => void;
}) {
  const [filled, setFilled] = useState<Filled | null>(null);

  const upload = async (file: File, onProgress: (percent: number) => void) => {
    onProgress(READ_PROGRESS);
    const prepared = await resumeUpload(file);
    if (!prepared) throw new Error(UNREADABLE);
    onProgress(FILL_PROGRESS);
    const result = await fillProfileFromResume({ ...prepared, profile });
    if (!result.ok) throw new Error(result.message);
    const next = withDefaults(result.data.profile);
    onProgress(DONE_PROGRESS);
    onFilled(next);
    setFilled({
      fileName: file.name,
      reader: result.data.reader ?? "layout",
      labels: filledLabels(next),
    });
  };

  return (
    <Card padding={6} variant="blue">
      <Stack gap={4}>
        <Stack gap={1}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Heading level={2}>Autofill from your résumé</Heading>
            <Badge label="AI" variant="purple" icon={<Glyph name="sparkle" />} />
          </HStack>
          <Text color="secondary" display="block">
            Drop a PDF or Word résumé. Acorn reads it like a recruiter would — name, contact,
            location, links, every role with its highlights, and your education — then saves it.
          </Text>
        </Stack>
        <FileUploader
          label="Résumé file"
          accept={RESUME_ACCEPT}
          isMultiple={false}
          maxFiles={1}
          maxSize={RESUME_MAX_BYTES}
          upload={upload}
          hint={`PDF, DOCX, or TXT · up to ${formatBytes(RESUME_MAX_BYTES)}`}
        />
        {filled ? (
          <Stack gap={2}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Glyph name="check" />
              <Text weight="semibold">{`Filled from ${filled.fileName}`}</Text>
              <Text type="supporting" color="secondary">
                {READER_NOTE[filled.reader]}
              </Text>
            </HStack>
            <HStack gap={2} wrap="wrap">
              {filled.labels.map((label) => (
                <Token key={label} label={label} size="sm" />
              ))}
            </HStack>
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}
