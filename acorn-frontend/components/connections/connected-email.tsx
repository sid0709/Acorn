"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Banner, Button, Glyph, HStack, SectionCard, Selector, Stack, Text } from "sid-ui";
import { AutolabelDialog } from "@/components/workspace/gmail/autolabel-dialog";
import { MailReader } from "@/components/workspace/gmail/mail-reader";
import { MailboxManager } from "@/components/workspace/gmail/mailbox-manager";
import { useGmailOverview } from "@/components/workspace/gmail/use-gmail-overview";
import { useMailboxActions } from "@/components/workspace/gmail/use-mailbox-actions";
import { useWorkspace } from "@/components/workspace/use-workspace";
import type { GmailRow } from "@/lib/gmail/types";
import { READ_MAIL_MAX } from "@/lib/gmail/views";
import { ROUTES } from "@/lib/routes";
import type { Mailbox } from "@/lib/workspace/model";
import { RecentReplies } from "./recent-replies";

/** Connected inboxes: label tools, and the latest labelled replies. */
export function ConnectedEmail({ mailboxes }: { mailboxes: Mailbox[] }) {
  const router = useRouter();
  const { workspace, update } = useWorkspace();
  const saveMailboxes = useMailboxActions(mailboxes);
  const primary = mailboxes.find((mailbox) => mailbox.isDefault) ?? mailboxes[0];
  const [mailboxId, setMailboxId] = useState(primary.id);
  const mailbox = mailboxes.find((item) => item.id === mailboxId) ?? primary;
  const [openRow, setOpenRow] = useState<GmailRow | null>(null);
  const [managing, setManaging] = useState(false);
  const [labeling, setLabeling] = useState(false);
  const { overview, error, refresh } = useGmailOverview(mailbox.id);
  const labels = useMemo(() => overview?.labels ?? [], [overview]);
  const labelMap = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
  const read = useMemo(() => new Set(workspace.readMail), [workspace.readMail]);
  const [version, setVersion] = useState(0);
  const connect = () => router.push(ROUTES.connectGmail);

  const open = (row: GmailRow) => {
    setOpenRow(row);
    if (row.isUnread && !read.has(row.id)) {
      update({ ...workspace, readMail: [...workspace.readMail, row.id].slice(-READ_MAIL_MAX) });
    }
  };
  const markUnread = (id: string) => {
    update({ ...workspace, readMail: workspace.readMail.filter((entry) => entry !== id) });
  };
  const usage = `${mailboxes.length} connected`;

  return (
    <SectionCard
      title="Email"
      description={`Connected as ${mailbox.email} · ${usage}`}
      action={
        <HStack gap={2} vAlign="center" wrap="wrap">
          {mailboxes.length > 1 ? (
            <Selector
              label="Mailbox"
              isLabelHidden
              options={mailboxes.map((item) => ({ value: item.id, label: item.email }))}
              value={mailbox.id}
              onChange={(value) => {
                setMailboxId(String(value));
                setOpenRow(null);
              }}
            />
          ) : null}
          <Button
            label="Manage labels"
            variant="secondary"
            icon={<Glyph name="tag" />}
            onClick={() => setLabeling(true)}
          />
          <Button
            label="Manage mailboxes"
            variant="ghost"
            icon={<Glyph name="settings" />}
            onClick={() => setManaging(true)}
          />
        </HStack>
      }
    >
      <Stack gap={4}>
        {error ? (
          <Banner status="warning" title="Couldn’t load your Gmail labels" description={error} />
        ) : null}
        <Text weight="semibold">Recent recruiter replies</Text>
        <RecentReplies
          mailboxId={mailbox.id}
          labels={labelMap}
          selectedId={openRow?.id ?? null}
          isUnread={(row) => row.isUnread && !read.has(row.id)}
          refreshKey={version}
          onOpen={open}
          onLabel={() => setLabeling(true)}
        />
      </Stack>
      <MailReader
        row={openRow}
        mailboxId={mailbox.id}
        mailboxEmail={mailbox.email}
        labels={labelMap}
        isUnreadHere={Boolean(openRow?.isUnread && read.has(openRow.id))}
        onClose={() => setOpenRow(null)}
        onMarkUnread={markUnread}
      />
      <MailboxManager
        isOpen={managing}
        onOpenChange={setManaging}
        mailboxes={mailboxes}
        onConnect={connect}
        onChange={(next) => void saveMailboxes(next)}
      />
      <AutolabelDialog
        isOpen={labeling}
        onOpenChange={setLabeling}
        mailboxId={mailbox.id}
        email={mailbox.email}
        canModify={mailbox.canModify}
        labels={labels}
        onApplied={() => {
          void refresh();
          setVersion((current) => current + 1);
        }}
      />
    </SectionCard>
  );
}
