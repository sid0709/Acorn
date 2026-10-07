"use client";

import { useSyncExternalStore, type PointerEvent, type FocusEvent, type ReactNode } from "react";
import {
  Banner,
  Button,
  Glyph,
  HStack,
  Heading,
  IconButton,
  MessageList,
  Pagination,
  Skeleton,
  Spinner,
  Stack,
  Text,
  TextInput,
  type GlyphName,
  type MessageListItem,
} from "sid-ui";

import type { GmailLabel, GmailRow } from "@/lib/gmail/types";
import { GMAIL_PAGE_SIZES, GMAIL_SEARCH_MAX, formatRowTime, rowChip } from "@/lib/gmail/views";

const SKELETON_ROWS = 8;

const noop = () => () => {};
/** Times follow the reader's clock and zone, so they render after hydration. */
function useIsClient() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

/** The row under the pointer or focus, by its position in the list. */
function rowIndexOf(target: EventTarget | null) {
  const item = target instanceof Element ? target.closest("li") : null;
  if (!item?.parentElement) return -1;
  return Array.prototype.indexOf.call(item.parentElement.children, item) as number;
}

export function MailList({
  title,
  glyph,
  rows,
  labels,
  viewing,
  isUnread,
  selectedId,
  search,
  onSearch,
  isLoading,
  error,
  page,
  pageSize,
  totalItems,
  hasMore,
  onPage,
  onPageSize,
  onOpen,
  onPrefetch,
  onRefresh,
  onMarkPageRead,
  viewPicker,
}: {
  title: string;
  glyph: GlyphName;
  /** Null while the first page of this list loads. */
  rows: GmailRow[] | null;
  labels: Map<string, GmailLabel>;
  /** The label being listed, left off each row's chip. */
  viewing: string;
  isUnread: (row: GmailRow) => boolean;
  selectedId: string | null;
  search: string;
  onSearch: (value: string) => void;
  isLoading: boolean;
  error: string;
  page: number;
  pageSize: number;
  /** Exact count when Gmail knows it; undefined for searches. */
  totalItems?: number;
  hasMore: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  onOpen: (row: GmailRow) => void;
  onPrefetch: (row: GmailRow) => void;
  onRefresh: () => void;
  onMarkPageRead: () => void;
  /** The folder picker shown when the sidebar is hidden on small screens. */
  viewPicker?: ReactNode;
}) {
  const isClient = useIsClient();
  const now = isClient ? new Date() : null;
  const items: MessageListItem[] = (rows ?? []).map((row) => ({
    id: row.id,
    sender: row.sender,
    subject: row.subject || "(no subject)",
    snippet: row.snippet,
    time: now ? formatRowTime(row.receivedAt, now) : "",
    isUnread: isUnread(row),
    tag: rowChip(row, labels, viewing),
  }));
  const hasUnread = (rows ?? []).some(isUnread);
  const byIndex = (index: number) => (rows && index >= 0 ? rows[index] : undefined);
  const prefetchAt = (event: PointerEvent | FocusEvent) => {
    const row = byIndex(rowIndexOf(event.target));
    if (row) onPrefetch(row);
  };

  return (
    <Stack gap={3} padding={5}>
      <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
        <HStack gap={2} vAlign="center">
          <Glyph name={glyph} />
          <Heading level={2}>{title}</Heading>
          {isLoading ? <Spinner size="sm" /> : null}
        </HStack>
        <HStack gap={2} vAlign="center" wrap="wrap">
          {viewPicker}
          <TextInput
            label="Search mail"
            isLabelHidden
            startIcon={<Glyph name="search" />}
            value={search}
            onChange={(value) => onSearch(value.slice(0, GMAIL_SEARCH_MAX))}
            placeholder="Search mail"
          />
          <IconButton
            label="Refresh"
            icon={<Glyph name="refresh" />}
            variant="ghost"
            size="sm"
            onClick={onRefresh}
          />
          <Button
            label="Mark page read"
            variant="ghost"
            size="sm"
            icon={<Glyph name="check" />}
            onClick={onMarkPageRead}
            isDisabled={!hasUnread}
          />
        </HStack>
      </HStack>
      {error ? <Banner status="error" title="Couldn’t load mail" description={error} /> : null}
      {rows === null && !error ? (
        <Stack gap={2}>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <Skeleton key={index} index={index} width="100%" height="2.5rem" />
          ))}
        </Stack>
      ) : (
        <div onPointerOver={prefetchAt} onFocus={prefetchAt}>
          <MessageList
            label={`${title} mail`}
            items={items}
            selectedId={selectedId}
            onSelect={(id) => {
              const row = rows?.find((item) => item.id === id);
              if (row) onOpen(row);
            }}
            empty={search ? "No mail matches your search." : "Nothing here."}
          />
        </div>
      )}
      <HStack gap={3} vAlign="center" hAlign="end" wrap="wrap">
        {totalItems === undefined && rows && rows.length > 0 ? (
          <Text type="supporting" color="secondary">{`Page ${page}`}</Text>
        ) : null}
        <Pagination
          label="Mail pages"
          variant="count"
          size="sm"
          page={page}
          onChange={onPage}
          totalItems={totalItems}
          hasMore={hasMore}
          pageSize={pageSize}
          pageSizeOptions={GMAIL_PAGE_SIZES}
          onPageSizeChange={onPageSize}
          isDisabled={isLoading}
        />
      </HStack>
    </Stack>
  );
}
