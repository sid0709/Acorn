"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  Banner,
  Button,
  Card,
  Glyph,
  GridColumn,
  GridSystem,
  HStack,
  PageHeader,
  Selector,
  Show,
  Stack,
} from "sid-ui";

import { fetchMessage, unreadAfterLocalReads } from "@/lib/gmail/client";
import {
  readPageSize,
  serverPageSize,
  subscribePageSize,
  writePageSize,
} from "@/lib/gmail/preferences";
import type { GmailListQuery, GmailOverview, GmailPage, GmailRow } from "@/lib/gmail/types";
import {
  GMAIL_SEARCH_DEBOUNCE_MS,
  INBOX,
  READ_MAIL_MAX,
  UNREAD,
  folderFor,
  searchFolder,
  systemFolders,
  userFolder,
  type GmailFolder,
} from "@/lib/gmail/views";
import { ROUTES } from "@/lib/routes";
import type { Mailbox } from "@/lib/workspace/model";

import { MailList } from "./gmail/mail-list";
import { MailReader } from "./gmail/mail-reader";
import { MailboxManager } from "./gmail/mailbox-manager";
import { MailboxSidebar } from "./gmail/mailbox-sidebar";
import { useGmailList } from "./gmail/use-gmail-list";
import { useGmailOverview } from "./gmail/use-gmail-overview";
import { useMailboxActions } from "./gmail/use-mailbox-actions";
import { useWorkspace } from "./use-workspace";

/** Bodies of the top rows load quietly once the page is idle, so they open instantly. */
const PREFETCH_BODIES = 5;
const IDLE_FALLBACK_MS = 300;

export type GmailInitial = {
  mailboxId: string;
  overview: GmailOverview | null;
  query: GmailListQuery;
  page: GmailPage | null;
};

/** Safari has no requestIdleCallback; a short timeout stands in. */
function whenIdle(run: () => void) {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run);
    return () => window.cancelIdleCallback(handle);
  }
  const handle = setTimeout(run, IDLE_FALLBACK_MS);
  return () => clearTimeout(handle);
}

export function GmailPanel({
  mailboxes,
  initial,
}: {
  mailboxes: Mailbox[];
  initial?: GmailInitial;
}) {
  const router = useRouter();
  const { workspace, update } = useWorkspace();
  const saveMailboxes = useMailboxActions(mailboxes);
  const primary = mailboxes.find((mailbox) => mailbox.isDefault) ?? mailboxes[0];
  const [mailboxId, setMailboxId] = useState(initial?.mailboxId ?? primary?.id ?? "");
  const mailbox = mailboxes.find((item) => item.id === mailboxId) ?? primary;
  const [folderKey, setFolderKey] = useState(INBOX);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [openRow, setOpenRow] = useState<GmailRow | null>(null);
  const [managing, setManaging] = useState(false);
  const pageSize = useSyncExternalStore(subscribePageSize, readPageSize, serverPageSize);

  const {
    overview,
    error: overviewError,
    refresh: refreshOverview,
  } = useGmailOverview(
    mailboxId,
    initial?.overview ? { mailboxId: initial.mailboxId, overview: initial.overview } : undefined,
  );
  const labels = useMemo(() => overview?.labels ?? [], [overview]);
  const labelMap = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
  const folder = folderFor(folderKey, labels);
  const listing = search ? searchFolder(search) : folder;
  const list = useGmailList(
    { mailboxId, labelId: listing.labelId, q: listing.q, pageSize },
    initial?.page ? { query: initial.query, page: initial.page } : undefined,
  );
  const rows = list.page?.messages ?? null;

  useEffect(() => {
    const trimmed = searchInput.trim();
    const handle = window.setTimeout(() => setSearch(trimmed), GMAIL_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    if (!rows || rows.length === 0) return;
    return whenIdle(() => {
      rows.slice(0, PREFETCH_BODIES).forEach((row) => void fetchMessage(mailboxId, row.id));
    });
  }, [rows, mailboxId]);

  const read = useMemo(() => new Set(workspace.readMail), [workspace.readMail]);
  const isUnread = (row: GmailRow) => row.isUnread && !read.has(row.id);
  const countFor = (item: GmailFolder) => {
    if (!item.count) return 0;
    const label = labelMap.get(item.count.labelId);
    if (!label) return 0;
    if (item.count.of === "total") return label.total;
    return unreadAfterLocalReads(label.id, label.unread, read);
  };
  const totalItems = (() => {
    if (listing !== folder || !folder.count) return undefined;
    const label = labelMap.get(folder.count.labelId);
    if (!label) return undefined;
    const known = folder.key === UNREAD ? label.unread : label.total;
    // Gmail's counts can drift from the listing; the last page settles the real total.
    if (rows && !list.isLoading && !list.hasMore)
      return (list.pageNumber - 1) * pageSize + rows.length;
    return known;
  })();

  const remember = (ids: string[]) => {
    const fresh = ids.filter((id) => !read.has(id));
    if (fresh.length === 0) return;
    update({ ...workspace, readMail: [...workspace.readMail, ...fresh].slice(-READ_MAIL_MAX) });
  };
  const open = (row: GmailRow) => {
    setOpenRow(row);
    if (row.isUnread) remember([row.id]);
  };
  const markUnread = (id: string) => {
    update({ ...workspace, readMail: workspace.readMail.filter((entry) => entry !== id) });
  };
  const selectFolder = (key: string) => {
    setFolderKey(key);
    setSearchInput("");
    setSearch("");
  };
  const refresh = () => {
    void list.refresh();
    void refreshOverview();
  };

  const profile = overview?.profile.email
    ? overview.profile
    : { email: mailbox?.email ?? "", name: mailbox?.name ?? "", picture: mailbox?.picture ?? "" };
  const folderOptions = [
    ...systemFolders(labels),
    ...labels.filter((label) => label.type === "user").map(userFolder),
  ].map((item) => ({ value: item.key, label: item.title }));
  const connect = () => router.push(ROUTES.gmailConnect);

  return (
    <Stack gap={6}>
      <PageHeader
        title="Gmail"
        description="Your connected inbox, with its own labels. Acorn reads Gmail and never changes it."
        action={
          <HStack gap={2} vAlign="center" wrap="wrap">
            {mailboxes.length > 1 ? (
              <Selector
                label="Mailbox"
                isLabelHidden
                options={mailboxes.map((item) => ({ value: item.id, label: item.email }))}
                value={mailboxId}
                onChange={(value) => {
                  setMailboxId(String(value));
                  selectFolder(INBOX);
                  setOpenRow(null);
                }}
              />
            ) : null}
            {mailbox ? (
              <Button
                label="Mailboxes"
                variant="secondary"
                icon={<Glyph name="settings" />}
                onClick={() => setManaging(true)}
              />
            ) : (
              <Button
                label="Connect Gmail"
                variant="primary"
                icon={<Glyph name="plus" />}
                onClick={connect}
              />
            )}
          </HStack>
        }
      />
      {mailbox ? null : (
        <Banner
          status="info"
          title="No Gmail connected"
          description="Connect the Gmail inbox you use for applications. Acorn does not use your Acorn sign-in email automatically."
          endContent={
            <Button
              label="Connect Gmail"
              variant="secondary"
              size="sm"
              icon={<Glyph name="plus" />}
              onClick={connect}
            />
          }
        />
      )}
      {mailbox && overviewError ? (
        <Banner
          status="warning"
          title="Couldn’t load your Gmail labels"
          description={overviewError}
        />
      ) : null}
      {mailbox ? (
        <Card padding={0}>
          <GridSystem gap={0} align="stretch">
            <GridColumn span="full" lg={3}>
              <Show from="lg" responsiveTo="viewport">
                <MailboxSidebar
                  profile={profile}
                  labels={labels}
                  selected={folder.key}
                  onSelect={selectFolder}
                  countFor={countFor}
                  onManage={() => setManaging(true)}
                />
              </Show>
            </GridColumn>
            <GridColumn span="full" lg={9}>
              <MailList
                title={listing.title}
                glyph={listing.glyph}
                rows={rows}
                labels={labelMap}
                viewing={listing.labelId}
                isUnread={isUnread}
                selectedId={openRow?.id ?? null}
                search={searchInput}
                onSearch={setSearchInput}
                isLoading={list.isLoading}
                error={list.error}
                page={list.pageNumber}
                pageSize={pageSize}
                totalItems={totalItems}
                hasMore={list.hasMore}
                onPage={list.goTo}
                onPageSize={writePageSize}
                onOpen={open}
                onPrefetch={(row) => void fetchMessage(mailboxId, row.id)}
                onRefresh={refresh}
                onMarkPageRead={() => remember((rows ?? []).filter(isUnread).map((row) => row.id))}
                viewPicker={
                  <Show below="lg" responsiveTo="viewport">
                    <Selector
                      label="Folder"
                      isLabelHidden
                      options={folderOptions}
                      value={folder.key}
                      onChange={(value) => selectFolder(String(value))}
                    />
                  </Show>
                }
              />
            </GridColumn>
          </GridSystem>
        </Card>
      ) : null}
      <MailReader
        row={openRow}
        mailboxId={mailboxId}
        mailboxEmail={profile.email}
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
    </Stack>
  );
}
