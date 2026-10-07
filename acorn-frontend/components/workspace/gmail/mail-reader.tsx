"use client";

import { useEffect, useState } from "react";
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Divider,
  Drawer,
  Glyph,
  HStack,
  MetadataList,
  MetadataListItem,
  Skeleton,
  Stack,
  Text,
} from "sid-ui";

import { gmailWebLink } from "@/lib/config";
import { fetchMessage } from "@/lib/gmail/client";
import type { GmailLabel, GmailMessage, GmailRow } from "@/lib/gmail/types";
import { formatFullTime, formatSize, labelBadge } from "@/lib/gmail/views";

import { MailBody } from "./mail-body";

const BODY_SKELETON_LINES = 6;

type Loaded = { id: string; message: GmailMessage | null; error: string };

/** One message, opened from the list. The row shows at once; the body follows. */
export function MailReader({
  row,
  mailboxId,
  mailboxEmail,
  labels,
  isUnreadHere,
  onClose,
  onMarkUnread,
}: {
  row: GmailRow | null;
  mailboxId: string;
  mailboxEmail: string;
  labels: Map<string, GmailLabel>;
  /** Gmail says unread and it was opened here, so it can go back to unread. */
  isUnreadHere: boolean;
  onClose: () => void;
  onMarkUnread: (id: string) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ id: "", message: null, error: "" });
  const id = row?.id ?? "";

  useEffect(() => {
    if (!id) return;
    let live = true;
    void fetchMessage(mailboxId, id).then((result) => {
      if (!live) return;
      setLoaded({
        id,
        message: result.ok ? result.data : null,
        error: result.ok ? "" : result.message,
      });
    });
    return () => {
      live = false;
    };
  }, [mailboxId, id]);

  if (!row) return null;
  const message = loaded.id === row.id ? loaded.message : null;
  const error = loaded.id === row.id ? loaded.error : "";
  const chips = row.labelIds
    .map((labelId) => labels.get(labelId))
    .filter((label): label is GmailLabel => label?.type === "user");

  return (
    <Drawer
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={row.subject || "(no subject)"}
      subtitle={`${row.sender} · ${formatFullTime(row.receivedAt)}`}
      headerStart={<Avatar name={row.sender} size={40} />}
      size="lg"
      footer={
        <HStack gap={2} hAlign="between" wrap="wrap">
          {isUnreadHere ? (
            <Button
              label="Mark unread"
              variant="secondary"
              icon={<Glyph name="dot" />}
              onClick={() => {
                onMarkUnread(row.id);
                onClose();
              }}
            />
          ) : (
            <span />
          )}
          <HStack gap={2} wrap="wrap">
            <Button
              label="Open in Gmail"
              variant="ghost"
              icon={<Glyph name="share" />}
              href={gmailWebLink(mailboxEmail, row.id)}
              target="_blank"
              rel="noopener noreferrer"
            />
            <Button label="Done" variant="primary" onClick={onClose} />
          </HStack>
        </HStack>
      }
    >
      <Stack gap={5}>
        <MetadataList columns={2}>
          <MetadataListItem label="From">
            {row.senderEmail ? `${row.sender} <${row.senderEmail}>` : row.sender}
          </MetadataListItem>
          <MetadataListItem label="To">{message?.to || mailboxEmail}</MetadataListItem>
          {message?.cc ? <MetadataListItem label="Cc">{message.cc}</MetadataListItem> : null}
          {message?.replyTo ? (
            <MetadataListItem label="Reply to">{message.replyTo}</MetadataListItem>
          ) : null}
          {chips.length > 0 ? (
            <MetadataListItem label="Labels">
              <HStack gap={1} wrap="wrap">
                {chips.map((label) => (
                  <Badge
                    key={label.id}
                    label={label.name}
                    variant={labelBadge(label)}
                    icon={<Glyph name="tag" />}
                  />
                ))}
              </HStack>
            </MetadataListItem>
          ) : null}
        </MetadataList>
        {message && message.attachments.length > 0 ? (
          <HStack gap={2} wrap="wrap">
            {message.attachments.map((file, index) => (
              <Badge
                key={`${file.filename}-${index}`}
                label={`${file.filename} · ${formatSize(file.size)}`}
                variant="neutral"
                icon={<Glyph name="file" />}
              />
            ))}
          </HStack>
        ) : null}
        <Divider />
        {error ? (
          <Banner status="error" title="Couldn’t open this message" description={error} />
        ) : message ? (
          <MailBody html={message.html} text={message.text} title={row.subject || "Message"} />
        ) : (
          <Stack gap={3}>
            <Text color="secondary">{row.snippet}</Text>
            {Array.from({ length: BODY_SKELETON_LINES }, (_, index) => (
              <Skeleton key={index} index={index} width="100%" height="1rem" />
            ))}
          </Stack>
        )}
      </Stack>
    </Drawer>
  );
}
