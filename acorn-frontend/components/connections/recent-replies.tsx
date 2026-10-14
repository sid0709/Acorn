"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  Banner,
  Button,
  EmptyState,
  Glyph,
  MessageList,
  Skeleton,
  Stack,
  type MessageListItem,
} from "sid-ui";
import { useGmailList } from "@/components/workspace/gmail/use-gmail-list";
import type { GmailLabel, GmailRow } from "@/lib/gmail/types";
import { LABELED_QUERY, RECENT_REPLIES_COUNT, formatRowTime, rowChip } from "@/lib/gmail/views";

const SKELETON_ROWS = 4;
const NO_VIEWING_LABEL = "";

const noop = () => () => {};
/** Times follow the reader's clock and zone, so they render after hydration. */
function useIsClient() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

/** The latest mail carrying a label Acorn (or you) applied: who wrote, about what, filed where. */
export function RecentReplies({
  mailboxId,
  labels,
  selectedId,
  isUnread,
  refreshKey,
  onOpen,
  onLabel,
}: {
  mailboxId: string;
  labels: Map<string, GmailLabel>;
  selectedId: string | null;
  isUnread: (row: GmailRow) => boolean;
  /** Changes when labels were applied, so the feed reloads. */
  refreshKey: number;
  onOpen: (row: GmailRow) => void;
  onLabel: () => void;
}) {
  const now = useIsClient() ? new Date() : null;
  const list = useGmailList({
    mailboxId,
    labelId: "",
    q: LABELED_QUERY,
    pageSize: RECENT_REPLIES_COUNT,
  });
  const { refresh } = list;
  useEffect(() => {
    if (refreshKey > 0) void refresh();
  }, [refreshKey, refresh]);

  if (list.error) {
    return <Banner status="error" title="Couldn’t load replies" description={list.error} />;
  }
  const rows = list.page?.messages ?? null;
  if (rows === null) {
    return (
      <Stack gap={2}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} index={index} width="100%" height="2.5rem" />
        ))}
      </Stack>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        isCompact
        icon={<Glyph name="mail" />}
        title="Labelled replies show up here"
        description="Describe your labels once, and Acorn files recruiter mail into them."
        actions={<Button label="Set up labels" variant="secondary" onClick={onLabel} />}
      />
    );
  }
  const items: MessageListItem[] = rows.map((row) => ({
    id: row.id,
    sender: row.sender,
    subject: row.subject || "(no subject)",
    snippet: row.snippet,
    time: now ? formatRowTime(row.receivedAt, now) : "",
    isUnread: isUnread(row),
    tag: rowChip(row, labels, NO_VIEWING_LABEL),
  }));
  return (
    <MessageList
      label="Recent recruiter replies"
      items={items}
      selectedId={selectedId}
      onSelect={(id) => {
        const row = rows.find((item) => item.id === id);
        if (row) onOpen(row);
      }}
      empty="Nothing here."
    />
  );
}
