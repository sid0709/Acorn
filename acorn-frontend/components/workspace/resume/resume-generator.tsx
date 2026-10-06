"use client";

import { useEffect, useState } from "react";
import {
  Banner,
  Button,
  FileUploader,
  GridColumn,
  GridSystem,
  HStack,
  ProgressBar,
  SectionCard,
  Selector,
  Stack,
  Text,
  TextArea,
} from "sid-ui";
import type { AcornAccount } from "@/lib/auth/session";
import {
  deleteResumeTemplate,
  listResumeTemplates,
  loadResumeConfig,
  pollResumeGenerate,
  previewGeneration,
  previewResume,
  saveResumeConfig,
  startResumeGenerate,
  uploadResumeTemplate,
} from "@/lib/resume/api";
import { identityFrom } from "@/lib/resume/identity";
import { JOB_DESCRIPTION_MAX, JOB_DESCRIPTION_ROWS } from "@/lib/workspace/model";
import { sampleProfile } from "@/lib/workspace/profile";
import { RESUME_FONT_OPTIONS, RESUME_PALETTES, resumeFontStack } from "@acorn/shared/resume-fonts";
import {
  defaultResumeConfig,
  mergeStoredResumeConfig,
  type ResumeGeneratorConfig,
} from "@acorn/shared/resume-config";
import {
  RESUME_TEMPLATES,
  isUploadedTemplateId,
  resumeTemplateById,
  uploadedTemplateId,
} from "@acorn/shared/resume-templates";
import { RESUME_TEMPLATE_ACCEPT, RESUME_TEMPLATE_MAX_BYTES } from "@acorn/shared/resume-library";
import { useResumes } from "./use-resumes";

const POLL_MS = 800;
const MAX_POLLS = 45;
const GENERATE_STEPS = 5;

type Uploaded = { id: string; name: string; warnings: string[] };

function fileBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  });
}

/** Template, font, uploaded DOCX, job description, and a live preview of the generated résumé. */
export function ResumeGenerator({ account }: { account: AcornAccount }) {
  const { workspace } = useResumes();
  const profile = workspace.profile ?? sampleProfile(account);
  const [config, setConfig] = useState<ResumeGeneratorConfig>(defaultResumeConfig);
  const [uploads, setUploads] = useState<Uploaded[]>([]);
  const [description, setDescription] = useState("");
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [doneSteps, setDoneSteps] = useState(0);

  const identity = identityFrom(account, profile);
  const template = resumeTemplateById(
    isUploadedTemplateId(config.templateId) ? "classic" : config.templateId,
  );

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const [stored, templates] = await Promise.all([loadResumeConfig(), listResumeTemplates()]);
      if (cancel) return;
      if (stored.ok) setConfig(mergeStoredResumeConfig(stored.data.config));
      if (templates.ok) setUploads(templates.data.templates);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const patch = (next: ResumeGeneratorConfig) => setConfig(next);

  const chooseTemplate = (id: string) => {
    const picked = resumeTemplateById(id);
    patch({
      ...config,
      templateId: id,
      theme: {
        ...config.theme,
        font: picked.defaults?.font ?? config.theme.font,
        accent: picked.defaults?.accent ?? config.theme.accent,
        headerAlign: picked.defaultHeaderAlign,
      },
    });
  };

  const refreshPreview = async (
    next: ResumeGeneratorConfig,
    sections?: Record<string, unknown>,
  ) => {
    const result = await previewResume({ identity, config: next, sections });
    if (result.ok) setHtml(result.data.html);
  };

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setBusy("Uploading template");
    setError("");
    const result = await uploadResumeTemplate({
      name: file.name.replace(/\.docx$/i, ""),
      fileName: file.name,
      contentBase64: await fileBase64(file),
    });
    setBusy("");
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setUploads((current) => [result.data.template, ...current]);
    chooseTemplate(uploadedTemplateId(result.data.template.id));
  };

  const removeUpload = async (id: string) => {
    const result = await deleteResumeTemplate(id);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setUploads((current) => current.filter((item) => item.id !== id));
    if (config.templateId === uploadedTemplateId(id)) chooseTemplate("classic");
  };

  const generate = async () => {
    const jobDescription = description.trim();
    if (!jobDescription) {
      setError("Paste the job description first.");
      return;
    }
    setError("");
    setBusy("Saving design");
    setDoneSteps(0);
    const next = { ...config, jobDescription };
    const saved = await saveResumeConfig(next);
    if (!saved.ok) {
      setBusy("");
      setError(saved.message);
      return;
    }
    setBusy("Generating");
    const started = await startResumeGenerate({ jobDescription, identity });
    if (!started.ok || !started.data.inputId) {
      setBusy("");
      setError(started.ok ? "Generate did not start." : started.message);
      return;
    }
    for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
      const polled = await pollResumeGenerate(started.data.inputId);
      if (!polled.ok) {
        setBusy("");
        setError(polled.message);
        return;
      }
      const finished =
        polled.data.progress?.steps.filter((step) => step.status === "done").length ?? 0;
      setDoneSteps(finished);
      if (polled.data.status === "failed") {
        setBusy("");
        setError(polled.data.error || "Generation failed.");
        return;
      }
      if (polled.data.status === "completed" && polled.data.generationId) {
        const view = await previewGeneration(polled.data.generationId);
        setBusy("");
        setDoneSteps(GENERATE_STEPS);
        if (!view.ok) {
          setError(view.message);
          return;
        }
        setHtml(view.data.html);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    setBusy("");
    setError("Generation is still running. Open History in a moment.");
  };

  const templateOptions = [
    ...RESUME_TEMPLATES.map((item) => ({ value: item.id, label: item.name })),
    ...uploads.map((item) => ({ value: uploadedTemplateId(item.id), label: item.name })),
  ];

  return (
    <Stack gap={4}>
      {error ? (
        <Banner status="error" title="Couldn’t update the résumé" description={error} />
      ) : null}
      <GridSystem gap={4} align="start">
        <GridColumn span="full" lg={5}>
          <Stack gap={4}>
            <SectionCard title="Design" description={template.blurb}>
              <Stack gap={3}>
                <Selector
                  label="Template"
                  value={config.templateId}
                  options={templateOptions}
                  onChange={chooseTemplate}
                />
                <Selector
                  label="Font"
                  value={config.theme.font}
                  options={RESUME_FONT_OPTIONS.map((font) => ({
                    value: font.value,
                    label: font.label,
                  }))}
                  onChange={(font) => patch({ ...config, theme: { ...config.theme, font } })}
                />
                <Selector
                  label="Palette"
                  value={
                    RESUME_PALETTES.find((item) => item.accent === config.theme.accent)?.name ??
                    "Navy"
                  }
                  options={RESUME_PALETTES.map((item) => ({ value: item.name, label: item.name }))}
                  onChange={(name) => {
                    const palette = RESUME_PALETTES.find((item) => item.name === name);
                    if (!palette) return;
                    patch({
                      ...config,
                      theme: { ...config.theme, accent: palette.accent, text: palette.text },
                    });
                  }}
                />
                <Text type="supporting" color="secondary">
                  {`Written for ${identity.fullName}. Edit the name on Profile.`}
                </Text>
                <Button
                  label="Refresh preview"
                  variant="secondary"
                  onClick={() => void refreshPreview(config)}
                />
              </Stack>
            </SectionCard>
            <SectionCard
              title="Uploaded template"
              description="A .docx with {summary}, {skills}, {title1}, and {experience1}."
            >
              <Stack gap={3}>
                <FileUploader
                  label="DOCX template"
                  accept={RESUME_TEMPLATE_ACCEPT}
                  maxSize={RESUME_TEMPLATE_MAX_BYTES}
                  maxFiles={1}
                  onChange={(files) => void upload(files)}
                />
                {uploads.map((item) => (
                  <HStack key={item.id} gap={2} vAlign="center">
                    <Text weight="semibold">{item.name}</Text>
                    <Button
                      label="Use"
                      variant="ghost"
                      size="sm"
                      onClick={() => chooseTemplate(uploadedTemplateId(item.id))}
                    />
                    <Button
                      label="Remove"
                      variant="ghost"
                      size="sm"
                      onClick={() => void removeUpload(item.id)}
                    />
                  </HStack>
                ))}
              </Stack>
            </SectionCard>
            <SectionCard
              title="Job description"
              description="The model writes summary, skills, and experience for this posting."
            >
              <Stack gap={3}>
                <TextArea
                  label="Posting"
                  value={description}
                  rows={JOB_DESCRIPTION_ROWS}
                  onChange={(value) => setDescription(value.slice(0, JOB_DESCRIPTION_MAX))}
                />
                {busy ? (
                  <ProgressBar
                    label={busy}
                    value={Math.round((doneSteps / GENERATE_STEPS) * 100)}
                    hasValueLabel
                    variant="accent"
                  />
                ) : null}
                <Button
                  label={busy || "Generate"}
                  variant="primary"
                  isDisabled={Boolean(busy)}
                  onClick={() => void generate()}
                />
              </Stack>
            </SectionCard>
          </Stack>
        </GridColumn>
        <GridColumn span="full" lg={7}>
          <SectionCard
            title="Preview"
            description={`Set in ${resumeFontStack(config.theme.font)}.`}
          >
            {html ? (
              <iframe
                title="Résumé preview"
                srcDoc={html}
                sandbox=""
                className="resume-preview-frame"
              />
            ) : (
              <Text color="secondary">
                Generate to see the résumé, or refresh the preview for the header.
              </Text>
            )}
          </SectionCard>
        </GridColumn>
      </GridSystem>
    </Stack>
  );
}
