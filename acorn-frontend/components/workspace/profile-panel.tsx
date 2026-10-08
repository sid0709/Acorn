"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Glyph,
  GridColumn,
  GridSystem,
  HStack,
  PageHeader,
  Stack,
  Sticky,
  Tab,
  TabList,
  type GlyphName,
} from "sid-ui";
import type { AcornAccount } from "@/lib/auth/session";
import { loadProfile, saveProfile } from "@/lib/profile/api";
import { readWorkspaceSnapshot, writeWorkspace } from "@/lib/workspace/model";
import {
  entriesOf,
  experienceMonths,
  formatDuration,
  sampleProfile,
  withDefaults,
  type ApplicantProfile,
  type SetProfileField,
} from "@/lib/workspace/profile";
import { AccountSettings } from "./profile/account-settings";
import { AssistantForm } from "./profile/assistant-form";
import { DisclosuresForm } from "./profile/disclosures-form";
import { IdentityForm } from "./profile/identity-form";
import { LogisticsForm } from "./profile/logistics-form";
import { ProfileSummary } from "./profile/profile-summary";
import { ResumeImport } from "./profile/resume-import";
import { TimelineSection } from "./profile/timeline-section";
import { useWorkspace } from "./use-workspace";

const SECTIONS = [
  { value: "identity", label: "Identity", icon: "user" },
  { value: "experience", label: "Experience", icon: "seat" },
  { value: "education", label: "Education", icon: "bookmark" },
  { value: "logistics", label: "Work & logistics", icon: "pin" },
  { value: "disclosures", label: "Disclosures", icon: "lock" },
  { value: "assistant", label: "Job bid & AI", icon: "sparkle" },
  { value: "account", label: "Account", icon: "settings" },
] as const satisfies { value: string; label: string; icon: GlyphName }[];
type Section = (typeof SECTIONS)[number]["value"];

export function ProfilePanel({ account }: { account: AcornAccount }) {
  const { workspace } = useWorkspace();
  const base = workspace.profile ?? sampleProfile(account);
  const [draft, setDraft] = useState<ApplicantProfile | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [section, setSection] = useState<Section>("identity");
  const profile = draft ?? base;

  useEffect(() => {
    let cancelled = false;
    void loadProfile().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.message);
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

  const edit = (next: ApplicantProfile) => {
    setDraft(next);
    setSaved(false);
  };

  const set: SetProfileField = (key, value) => edit({ ...profile, [key]: value });

  const filled = (next: ApplicantProfile) => {
    keep(next);
    setNotice("");
    setError("");
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    const result = await saveProfile(profile);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      setSaved(false);
      return;
    }
    keep(withDefaults(result.data.profile));
    setNotice("");
    setSaved(true);
  };

  const today = new Date();
  const unsaved = draft !== null;
  const counts: Partial<Record<Section, number>> = {
    experience: entriesOf(profile, "role").length,
    education: entriesOf(profile, "education").length,
  };

  return (
    <Stack gap={6}>
      <PageHeader
        title="Profile"
        description="Who Acorn applies as: identity, experience, education, and the answers it types into applications."
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
      {error ? <Banner status="error" title={error} /> : null}
      <GridSystem gap={4} align="start">
        <GridColumn span="full" lg={4}>
          <Sticky offset={4}>
            <ProfileSummary
              profile={profile}
              experience={formatDuration(experienceMonths(profile, today))}
            />
          </Sticky>
        </GridColumn>
        <GridColumn span="full" lg={8}>
          <Stack gap={4}>
            <ResumeImport profile={profile} onFilled={filled} />
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
                  endContent={
                    counts[item.value] ? (
                      <Badge label={String(counts[item.value])} variant="neutral" />
                    ) : undefined
                  }
                />
              ))}
            </TabList>
            {section === "identity" ? <IdentityForm profile={profile} onChange={set} /> : null}
            {section === "experience" ? (
              <TimelineSection kind="role" profile={profile} today={today} onChange={edit} />
            ) : null}
            {section === "education" ? (
              <TimelineSection kind="education" profile={profile} today={today} onChange={edit} />
            ) : null}
            {section === "logistics" ? <LogisticsForm profile={profile} onChange={set} /> : null}
            {section === "disclosures" ? (
              <DisclosuresForm profile={profile} onChange={set} />
            ) : null}
            {section === "assistant" ? <AssistantForm profile={profile} onChange={set} /> : null}
            {section === "account" ? (
              <AccountSettings email={account.email} profile={profile} onChange={set} />
            ) : null}
          </Stack>
        </GridColumn>
      </GridSystem>
    </Stack>
  );
}
