"use client";

import { useState, useSyncExternalStore } from "react";
import {
  Banner,
  Button,
  CheckboxInput,
  CheckboxList,
  CheckboxListItem,
  Glyph,
  HStack,
  Heading,
  Pagination,
  Skeleton,
  Spinner,
  Stack,
  Switch,
  Text,
} from "sid-ui";

import {
  readAutolabelPageSize,
  serverAutolabelPageSize,
  subscribeAutolabelPageSize,
  writeAutolabelPageSize,
} from "@/lib/gmail/preferences";
import type { GmailRow } from "@/lib/gmail/types";
import { GMAIL_PAGE_SIZES, INBOX, UNLABELED_QUERY, formatRowTime } from "@/lib/gmail/views";

import { useGmailList } from "./use-gmail-list";

const SKELETON_ROWS = 4;

/** The page of mail Autolabel can file. Selection never extends past this page. */
export function AutolabelMail({
  mailboxId,
  canRun,
  hint,
  running,
  onRun,
}: {
  mailboxId: string;
  canRun: boolean;
  hint: string;
  running: boolean;
  onRun: (rows: GmailRow[]) => Promise<boolean>;
}) {
  const pageSize = useSyncExternalStore(
    subscribeAutolabelPageSize,
    readAutolabelPageSize,
    serverAutolabelPageSize,
  );
  const [unlabeledOnly, setUnlabeledOnly] = useState(true);
  const q = unlabeledOnly ? UNLABELED_QUERY : "";
  const list = useGmailList({ mailboxId, labelId: INBOX, q, pageSize });
  const rows = list.page?.messages ?? null;
  const pageKey = [q, list.pageNumber, pageSize].join("\u0000");
  const [selection, setSelection] = useState({ key: pageKey, ids: [] as string[] });
  const selected = selection.key === pageKey ? selection.ids : [];
  const setSelected = (ids: string[]) => setSelection({ key: pageKey, ids });

  const ids = (rows ?? []).map((row) => row.id);
  const selectedCount = ids.filter((id) => selected.includes(id)).length;
  const pageValue =
    ids.length === 0
      ? false
      : selectedCount === ids.length
        ? true
        : selectedCount > 0
          ? "indeterminate"
          : false;
  const picked = (rows ?? []).filter((row) => selected.includes(row.id));
  const now = new Date();

  const run = async () => {
    const ok = await onRun(picked);
    if (!ok) return;
    setSelected([]);
    await list.refresh();
  };

  return (
    <Stack gap={3}>
      <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
        <HStack gap={2} vAlign="center">
          <Heading level={3}>Mail</Heading>
          {list.isLoading ? <Spinner size="sm" /> : null}
        </HStack>
        <Switch
          label="Unlabeled only"
          description="Skip mail that already has a label."
          value={unlabeledOnly}
          onChange={setUnlabeledOnly}
          isDisabled={running}
        />
      </HStack>
      <Text type="supporting" color="secondary">
        Select mail on this page. Autolabel does not run on the rest of the inbox.
      </Text>
      {list.error ? (
        <Banner status="error" title="Couldn’t load mail" description={list.error} />
      ) : null}
      {list.error ? null : rows === null ? (
        <Stack gap={2}>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <Skeleton key={index} index={index} width="100%" height="2.5rem" />
          ))}
        </Stack>
      ) : (
        <Stack gap={3}>
          <CheckboxInput
            label="Select this page"
            value={pageValue}
            onChange={(checked) => setSelected(checked ? ids : [])}
            isDisabled={running || ids.length === 0}
          />
          <CheckboxList
            label="Mail to label"
            isLabelHidden
            value={selected}
            onChange={setSelected}
            isDisabled={running}
            hasDividers
          >
            {(rows ?? []).map((row) => (
              <CheckboxListItem
                key={row.id}
                value={row.id}
                label={row.subject || "(no subject)"}
                description={`${row.sender} — ${row.snippet}`}
                endContent={
                  <Text type="supporting" color="secondary">
                    {formatRowTime(row.receivedAt, now)}
                  </Text>
                }
              />
            ))}
          </CheckboxList>
          {(rows ?? []).length === 0 ? (
            <Text color="secondary">
              {unlabeledOnly ? "No unlabeled mail on this page." : "Nothing in the inbox."}
            </Text>
          ) : null}
        </Stack>
      )}
      <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
        <Stack gap={1}>
          <Button
            label={
              running ? "Labeling…" : picked.length > 0 ? `Autolabel ${picked.length}` : "Autolabel"
            }
            variant="primary"
            icon={<Glyph name="sparkle" />}
            onClick={() => void run()}
            isDisabled={running || picked.length === 0 || !canRun}
          />
          {hint ? (
            <Text type="supporting" color="secondary">
              {hint}
            </Text>
          ) : null}
        </Stack>
        <Pagination
          label="Autolabel pages"
          variant="count"
          size="sm"
          page={list.pageNumber}
          onChange={list.goTo}
          hasMore={list.hasMore}
          pageSize={pageSize}
          pageSizeOptions={GMAIL_PAGE_SIZES}
          onPageSizeChange={writeAutolabelPageSize}
          isDisabled={list.isLoading || running}
        />
      </HStack>
    </Stack>
  );
}
