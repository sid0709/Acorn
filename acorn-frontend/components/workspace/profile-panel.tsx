"use client";

import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  FileUploader,
  Glyph,
  GridColumn,
  GridSystem,
  HStack,
  PageHeader,
  SectionCard,
  Stack,
  Tab,
  TabList,
  type GlyphName,
} from "sid-ui";
import type { AcornAccount } from "@/lib/auth/session";
import { fillProfileFromResume, loadProfile, saveProfile } from "@/lib/profile/api";
import { readWorkspaceSnapshot, writeWorkspace } from "@/lib/workspace/model";
import {
  MIN_RESUME_TEXT,
  RESUME_ACCEPT,
  RESUME_MAX_BYTES,
  bytesToBase64,
  readResumeFile,
} from "@/lib/workspace/resume-file";
import {
  experienceMonths,
  formatDuration,
  sampleProfile,
  withDefaults,
  type ApplicantProfile,
} from "@/lib/workspace/profile";
import { AssistantForm } from "./profile/assistant-form";
import { CareerChart } from "./profile/career-chart";
import { DisclosuresForm } from "./profile/disclosures-form";
import { IdentityForm } from "./profile/identity-form";
import { LogisticsForm } from "./profile/logistics-form";
import { ProfileSummary } from "./profile/profile-summary";
import { ProfileTimeline } from "./profile-timeline";
import { useWorkspace } from "./use-workspace";

const SECTIONS = [
  { value: "identity", label: "Identity", icon: "user" },
  { value: "logistics", label: "Work & logistics", icon: "pin" },
  { value: "disclosures", label: "Disclosures", icon: "lock" },
  { value: "assistant", label: "Job bid & AI", icon: "sparkle" },
  { value: "career", label: "Career", icon: "calendar" },
] as const satisfies { value: string; label: string; icon: GlyphName }[];
type Section = (typeof SECTIONS)[number]["value"];

export function ProfilePanel({ account }: { account: AcornAccount }) {
  const { workspace } = useWorkspace();
  const base = workspace.profile ?? sampleProfile(account);
  const [draft, setDraft] = useState<ApplicantProfile | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [notice, setNotice] = useState("");
  const [section, setSection] = useState<Section>("identity");
  const seenUpload = useRef("");
  const profile = draft ?? base;

  useEffect(() => {
    let cancelled = false;
    void loadProfile().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setUploadError(result.message);
        return;
      }
      const current = readWorkspaceSnapshot();
      if (!result.data.stored && current.profile) {
        setDraft(withDefaults(current.profile));
        setNotice("This profile is on this browser. Save it to keep it on your account.");
        return;
      }
      const next = withDefaults(result.data.profile);
      setDraft(null);
      writeWorkspace({ ...current, profile: next });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const keep = (next: ApplicantProfile) => {
    setDraft(null);
    writeWorkspace({ ...readWorkspaceSnapshot(), profile: next });
  };

  const fillFromUpload = async (file: File | undefined) => {
    if (!file) return;
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seenUpload.current === key) return;
    seenUpload.current = key;
    setUploadError("");
    setUploadNote("");
    const docx = file.name.toLowerCase().endsWith(".docx");
    const text = docx ? "" : await readResumeFile(file);
    if (!docx && text.trim().length < MIN_RESUME_TEXT) {
      setUploadError(
        "Couldn't read text from that file. Use a PDF with selectable text, a .docx, or a .txt file.",
      );
      return;
    }
    const result = await fillProfileFromResume({
      fileName: file.name,
      text: docx ? undefined : text,
      contentBase64: docx ? bytesToBase64(new Uint8Array(await file.arrayBuffer())) : undefined,
      profile,
    });
    if (!result.ok) {
      setUploadError(result.message);
      return;
    }
    const next = withDefaults(result.data.profile);
    keep(next);
    setNotice("");
    setUploadNote(`Filled the profile from ${file.name} and saved it.`);
    setSaved(true);
  };

  const set = <K extends keyof ApplicantProfile>(key: K, value: ApplicantProfile[K]) => {
    setDraft({ ...profile, [key]: value });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setUploadError("");
    const result = await saveProfile(profile);
    setSaving(false);
    if (!result.ok) {
      setUploadError(result.message);
      setSaved(false);
      return;
    }
    keep(withDefaults(result.data.profile));
    setNotice("");
    setSaved(true);
  };

  const today = new Date();
  const unsaved = draft !== null;

  return (
    <Stack gap={6}>
      <PageHeader
        title="Profile"
        description="Identity, disclosures, and the career timeline Acorn types into applications."
        action={
          <HStack gap={3} vAlign="center">
            {unsaved ? <Badge label="Unsaved changes" variant="warning" /> : null}
            <Button
              label="Save profile"
              variant="primary"
              onClick={() => {
                void save();
              }}
              isDisabled={!unsaved || saving}
            />
          </HStack>
        }
      />
      {saved ? <Banner status="success" title="Profile saved to your account." /> : null}
      {notice ? <Banner status="warning" title={notice} /> : null}
      {uploadNote ? <Banner status="success" title={uploadNote} /> : null}
      {uploadError ? <Banner status="error" title={uploadError} /> : null}
      <GridSystem gap={4} align="start">
        <GridColumn span="full" lg={4}>
          <Stack gap={4}>
            <ProfileSummary
              profile={profile}
              experience={formatDuration(experienceMonths(profile, today))}
            />
            <SectionCard
              title="Upload résumé"
              description="A PDF, Word, or text résumé fills your name, contact, links, and timeline, then saves them."
            >
              <FileUploader
                label="Résumé file"
                accept={RESUME_ACCEPT}
                isMultiple={false}
                maxFiles={1}
                maxSize={RESUME_MAX_BYTES}
                onChange={(files) => {
                  void fillFromUpload(files[0]);
                }}
              />
            </SectionCard>
          </Stack>
        </GridColumn>
        <GridColumn span="full" lg={8}>
          <Stack gap={4}>
            <TabList
              value={section}
              onChange={(value) => setSection(value as Section)}
              hasDivider
              overflow="scroll"
            >
              {SECTIONS.map((item) => (
                <Tab
                  key={item.value}
                  value={item.value}
                  label={item.label}
                  icon={<Glyph name={item.icon} />}
                />
              ))}
            </TabList>
            {section === "identity" ? <IdentityForm profile={profile} onChange={set} /> : null}
            {section === "logistics" ? <LogisticsForm profile={profile} onChange={set} /> : null}
            {section === "disclosures" ? (
              <DisclosuresForm profile={profile} onChange={set} />
            ) : null}
            {section === "assistant" ? <AssistantForm profile={profile} onChange={set} /> : null}
            {section === "career" ? (
              <Stack gap={4}>
                <SectionCard
                  title="Time in each role"
                  description="Your current role is highlighted."
                >
                  <CareerChart profile={profile} today={today} />
                </SectionCard>
                <ProfileTimeline profile={profile} onChange={setDraft} />
              </Stack>
            ) : null}
          </Stack>
        </GridColumn>
      </GridSystem>
    </Stack>
  );
}
