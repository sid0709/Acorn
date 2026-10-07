"use client";

import { useEffect, useState } from "react";
import { GMAIL_AUTH_ROUTE } from "@acorn/google-gmail";
import {
  Banner,
  Button,
  Dialog,
  DialogHeader,
  Divider,
  Heading,
  Layout,
  LayoutContent,
  LayoutFooter,
  Stack,
  Text,
  TextArea,
} from "sid-ui";

import {
  autolabelMessages,
  autolabelSummary,
  loadLabelGuides,
  saveLabelGuides,
} from "@/lib/gmail/autolabel";
import type { AutolabelOutcome, GmailLabel, GmailRow } from "@/lib/gmail/types";
import { GUIDE_DESCRIPTION_MAX } from "@/lib/gmail/views";
import { ROUTES } from "@/lib/routes";

import { AutolabelMail } from "./autolabel-mail";

const DIALOG_WIDTH = 760;

function userLabels(labels: GmailLabel[]) {
  return labels.filter((label) => label.type === "user");
}

function guidesRecord(labels: GmailLabel[], guides: { labelId: string; description: string }[]) {
  const byId = new Map(guides.map((guide) => [guide.labelId, guide.description]));
  const record: Record<string, string> = {};
  for (const label of userLabels(labels)) record[label.id] = byId.get(label.id) ?? "";
  return record;
}

function sameGuides(left: Record<string, string>, right: Record<string, string>) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? "").trim() !== (right[key] ?? "").trim()) return false;
  }
  return true;
}

function described(record: Record<string, string>) {
  return Object.values(record).some((value) => value.trim() !== "");
}

/** Descriptions for this mailbox's labels, then one page of mail to file with them. */
export function AutolabelDialog({
  isOpen,
  onOpenChange,
  mailboxId,
  email,
  canModify,
  labels,
  onApplied,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  mailboxId: string;
  email: string;
  canModify: boolean;
  labels: GmailLabel[];
  onApplied: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [guideError, setGuideError] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [notice, setNotice] = useState<AutolabelOutcome | null>(null);
  const custom = userLabels(labels);
  const labelKey = custom.map((label) => label.id).join("\u0000");
  const dirty = !sameGuides(draft, saved);
  const hasGuide = described(saved);

  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    void loadLabelGuides(mailboxId).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setGuideError(result.message);
        return;
      }
      setGuideError("");
      const record = guidesRecord(custom, result.data.guides);
      setDraft(record);
      setSaved(record);
    });
    return () => {
      live = false;
    };
    // custom is derived from labelKey; depending on the array would refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mailboxId, labelKey]);

  const save = async () => {
    setSaving(true);
    setGuideError("");
    const guides = custom.map((label) => ({
      labelId: label.id,
      description: (draft[label.id] ?? "").trim().slice(0, GUIDE_DESCRIPTION_MAX),
    }));
    const result = await saveLabelGuides(mailboxId, guides);
    setSaving(false);
    if (!result.ok) {
      setGuideError(result.message);
      return;
    }
    const record = guidesRecord(custom, result.data.guides);
    setDraft(record);
    setSaved(record);
  };

  const run = async (rows: GmailRow[]) => {
    setRunning(true);
    setRunError("");
    setNotice(null);
    const result = await autolabelMessages(mailboxId, rows);
    setRunning(false);
    if (!result.ok) {
      setRunError(result.message);
      return false;
    }
    setNotice(result.data);
    onApplied();
    return true;
  };

  const hint = !canModify
    ? ""
    : dirty
      ? "Save descriptions before labeling."
      : hasGuide
        ? ""
        : "Add a description to at least one label.";

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      purpose="form"
      width={DIALOG_WIDTH}
      maxHeight="85dvh"
    >
      <Layout
        height="fill"
        header={
          <DialogHeader
            title="Autolabel"
            subtitle="Describe each label, then label the mail on this page."
            onOpenChange={onOpenChange}
            hasDivider
          />
        }
        content={
          <LayoutContent>
            <Stack gap={5}>
              {guideError ? <Banner status="error" title={guideError} /> : null}
              {runError ? <Banner status="error" title={runError} /> : null}
              {notice ? (
                <Banner
                  status={notice.failed > 0 || notice.labeled === 0 ? "warning" : "success"}
                  title={autolabelSummary(notice)}
                />
              ) : null}
              {!canModify ? (
                <Banner
                  status="info"
                  title="Labeling needs permission"
                  description="Reconnect this Gmail so Acorn can apply labels. Descriptions you save stay on this account."
                  endContent={
                    <form action={GMAIL_AUTH_ROUTE} method="post">
                      <input type="hidden" name="email" value={email} />
                      <input type="hidden" name="reauthorize" value="1" />
                      <input type="hidden" name="next" value={ROUTES.gmail} />
                      <Button label="Allow labeling" variant="secondary" size="sm" type="submit" />
                    </form>
                  }
                />
              ) : null}
              <Stack gap={4}>
                <Stack gap={1}>
                  <Heading level={3}>Labels</Heading>
                  <Text type="supporting" color="secondary">
                    Each description tells Acorn when to use that label.
                  </Text>
                </Stack>
                {custom.length === 0 ? (
                  <Text color="secondary">
                    This Gmail has no custom labels yet. Create them in Gmail, then describe them
                    here.
                  </Text>
                ) : (
                  custom.map((label) => (
                    <TextArea
                      key={label.id}
                      label={label.name}
                      value={draft[label.id] ?? ""}
                      rows={2}
                      placeholder="When this label applies"
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          [label.id]: value.slice(0, GUIDE_DESCRIPTION_MAX),
                        }))
                      }
                      isDisabled={saving || running}
                    />
                  ))
                )}
              </Stack>
              <Divider />
              {isOpen ? (
                <AutolabelMail
                  mailboxId={mailboxId}
                  canRun={canModify && !dirty && hasGuide && !saving}
                  hint={hint}
                  running={running}
                  onRun={run}
                />
              ) : null}
            </Stack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <Button
              label={saving ? "Saving…" : "Save descriptions"}
              variant="secondary"
              onClick={() => void save()}
              isDisabled={saving || running || !dirty || custom.length === 0}
            />
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
