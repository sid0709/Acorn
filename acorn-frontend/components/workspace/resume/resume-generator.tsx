"use client";

import { useEffect, useRef, useState } from "react";
import {
  Banner,
  Button,
  Glyph,
  GridColumn,
  GridSystem,
  ProgressBar,
  SectionCard,
  Stack,
  Text,
  TextArea,
} from "sid-ui";
import type { AcornAccount } from "@/lib/auth/session";
import {
  deleteResumeTemplate,
  downloadGeneration,
  listResumeTemplates,
  loadResumeConfig,
  previewResume,
  saveResumeConfig,
  uploadResumeTemplate,
} from "@/lib/resume/api";
import { FALLBACK_TEMPLATE_ID, PREVIEW_DEBOUNCE_MS, withTemplate } from "@/lib/resume/design";
import { identityFrom } from "@/lib/resume/identity";
import { JOB_DESCRIPTION_MAX, JOB_DESCRIPTION_ROWS } from "@/lib/workspace/model";
import { sampleProfile } from "@/lib/workspace/profile";
import { bytesToBase64, saveBase64File } from "@/lib/workspace/resume-file";
import {
  defaultResumeConfig,
  mergeStoredResumeConfig,
  type ResumeGeneratorConfig,
} from "@acorn/shared/resume-config";
import { resumeSampleSections } from "@acorn/shared/resume-samples";
import {
  isUploadedTemplateId,
  resumeTemplateById,
  uploadedTemplateId,
} from "@acorn/shared/resume-templates";
import { DesignCard } from "./design-card";
import { LivePreview, type PreviewStage } from "./live-preview";
import { SectionsCard } from "./sections-card";
import { TemplateGallery, type UploadedTemplate } from "./template-gallery";
import { TypographyCard } from "./typography-card";
import { GENERATE_STEPS, useResumeGenerate } from "./use-resume-generate";
import { useResumes } from "./use-resumes";
import { useTemplateThumbs } from "./use-template-thumbs";

/** Design choices persist on their own after this pause, so they survive a reload. */
const CONFIG_SAVE_DEBOUNCE_MS = 800;

const PAPER_LABEL = { letter: "US Letter · 8.5 × 11 in", a4: "A4 · 210 × 297 mm" } as const;

type ResumeStart = {
  config: Awaited<ReturnType<typeof loadResumeConfig>>;
  templates: Awaited<ReturnType<typeof listResumeTemplates>>;
};

/** Live page on one side, design and posting on the other — the Athens generator layout on sid-ui. */
export function ResumeGenerator({
  account,
  initial,
}: {
  account: AcornAccount;
  initial: ResumeStart;
}) {
  const { workspace } = useResumes();
  const profile = workspace.profile ?? sampleProfile(account);
  const identity = identityFrom(account, profile);
  const ready = initial.config.ok && initial.templates.ok;
  const [config, setConfig] = useState<ResumeGeneratorConfig>(() =>
    initial.config.ok ? mergeStoredResumeConfig(initial.config.data.config) : defaultResumeConfig(),
  );
  const [loaded, setLoaded] = useState(ready);
  const [uploads, setUploads] = useState<UploadedTemplate[]>(() =>
    initial.templates.ok ? initial.templates.data.templates : [],
  );
  const [uploading, setUploading] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const run = useResumeGenerate(setError);
  const thumbs = useTemplateThumbs(galleryOpen, identity, config);
  const previewSeq = useRef(0);

  const uploadedTemplate = isUploadedTemplateId(config.templateId)
    ? uploads.find((item) => uploadedTemplateId(item.id) === config.templateId)
    : undefined;
  const template = resumeTemplateById(
    isUploadedTemplateId(config.templateId) ? FALLBACK_TEMPLATE_ID : config.templateId,
  );
  const identityKey = JSON.stringify(identity);

  useEffect(() => {
    if (ready) return;
    let cancel = false;
    void (async () => {
      const [stored, templates] = await Promise.all([loadResumeConfig(), listResumeTemplates()]);
      if (cancel) return;
      if (stored.ok) setConfig(mergeStoredResumeConfig(stored.data.config));
      if (templates.ok) setUploads(templates.data.templates);
      setLoaded(true);
    })();
    return () => {
      cancel = true;
    };
  }, [ready]);

  // Re-render the page whenever the design, the person, or the written sections change.
  useEffect(() => {
    const seq = ++previewSeq.current;
    const timer = setTimeout(() => {
      void (async () => {
        const result = await previewResume({
          identity,
          config,
          sections: run.sections ?? resumeSampleSections(identity),
        });
        if (seq === previewSeq.current && result.ok) setHtml(result.data.html);
      })();
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // identity is rebuilt every render; its serialized form is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, run.sections, identityKey]);

  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => void saveResumeConfig(config), CONFIG_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [config, loaded]);

  const chooseTemplate = (id: string) => setConfig((current) => withTemplate(current, id));

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const result = await uploadResumeTemplate({
      name: file.name.replace(/\.docx$/i, ""),
      fileName: file.name,
      contentBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
    });
    setUploading(false);
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
    if (config.templateId === uploadedTemplateId(id)) chooseTemplate(FALLBACK_TEMPLATE_ID);
  };

  const generate = () => {
    const jobDescription = description.trim();
    if (!jobDescription) {
      setError("Paste the job description first.");
      return;
    }
    setError("");
    void run.generate(config, jobDescription, identity);
  };

  const download = async () => {
    if (!run.generationId) return;
    setDownloading(true);
    const result = await downloadGeneration(run.generationId);
    setDownloading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    saveBase64File(result.data.name, result.data.base64);
  };

  const stage: PreviewStage = run.busy ? "writing" : run.generationId ? "ready" : "sample";

  return (
    <Stack gap={4}>
      {error ? (
        <Banner status="error" title="Couldn’t update the résumé" description={error} />
      ) : null}
      <GridSystem gap={4} align="stretch" responsiveTo="viewport">
        <GridColumn span="full" lg={7}>
          <div className="resume-preview-column">
            <LivePreview
              html={html}
              stage={stage}
              paperLabel={`${template.name} · ${PAPER_LABEL[config.theme.paper]}`}
              downloading={downloading}
              onDownload={run.generationId && !run.busy ? () => void download() : undefined}
            />
          </div>
        </GridColumn>
        <GridColumn span="full" lg={5}>
          <Stack gap={4}>
            <SectionCard
              title="Job description"
              description="The model writes summary, skills, and experience for this posting."
            >
              <Stack gap={3}>
                <TextArea
                  label="Posting"
                  value={description}
                  rows={JOB_DESCRIPTION_ROWS}
                  placeholder="Paste the full posting: role, responsibilities, requirements."
                  onChange={(value) => setDescription(value.slice(0, JOB_DESCRIPTION_MAX))}
                />
                <Text type="supporting" color="secondary">
                  {`Written for ${identity.fullName}. Edit your name and roles on Profile.`}
                </Text>
                {run.busy ? (
                  <ProgressBar
                    label={run.busy}
                    value={Math.round((run.doneSteps / GENERATE_STEPS) * 100)}
                    hasValueLabel
                    variant="accent"
                  />
                ) : null}
                <Button
                  label={
                    run.busy ? "Generating…" : run.generationId ? "Generate again" : "Generate"
                  }
                  variant="primary"
                  icon={<Glyph name="sparkle" />}
                  isLoading={Boolean(run.busy)}
                  isDisabled={Boolean(run.busy)}
                  onClick={generate}
                />
              </Stack>
            </SectionCard>
            <DesignCard
              config={config}
              templateName={uploadedTemplate?.name ?? template.name}
              templateBlurb={uploadedTemplate ? "Your Word template" : template.blurb}
              onChange={setConfig}
              onBrowse={() => setGalleryOpen(true)}
            />
            {isUploadedTemplateId(config.templateId) ? null : (
              <>
                <SectionsCard config={config} onChange={setConfig} />
                <TypographyCard config={config} onChange={setConfig} />
              </>
            )}
          </Stack>
        </GridColumn>
      </GridSystem>
      <TemplateGallery
        isOpen={galleryOpen}
        onOpenChange={setGalleryOpen}
        selectedId={config.templateId}
        thumbs={thumbs}
        uploads={uploads}
        uploading={uploading}
        onSelect={chooseTemplate}
        onUpload={(files) => void upload(files)}
        onRemoveUpload={(id) => void removeUpload(id)}
      />
    </Stack>
  );
}
