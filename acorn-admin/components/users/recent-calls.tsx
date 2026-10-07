"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Badge,
  Drawer,
  MetadataList,
  MetadataListItem,
  Pagination,
  SectionCard,
  Stack,
  Table,
  Text,
  type BadgeVariant,
  type TableColumn,
} from "sid-ui";

import type { UsageEntry } from "@/lib/api/users";

import { formatCount, formatDateTime, formatMs, formatUSD } from "@/lib/format";
import { clientLabel, errorKindLabel, featureLabel } from "@/lib/statistics/labels";

const CALLS_PAGE_PARAM = "calls";

const STATUS: Record<UsageEntry["status"], { label: string; variant: BadgeVariant }> = {
  ok: { label: "OK", variant: "success" },
  error: { label: "Failed", variant: "error" },
  cancelled: { label: "Cancelled", variant: "neutral" },
};

function StatusBadge({ entry }: { entry: UsageEntry }) {
  const status = STATUS[entry.status] ?? STATUS.error;
  const label =
    entry.status === "error" && entry.errorKind ? errorKindLabel(entry.errorKind) : status.label;
  return <Badge label={label} variant={status.variant} />;
}

const columns: TableColumn<UsageEntry>[] = [
  { key: "createdAt", header: "When", render: (r) => formatDateTime(r.createdAt) },
  {
    key: "feature",
    header: "Feature",
    render: (r) => (
      <Stack gap={0}>
        <Text weight="medium">{featureLabel(r.feature || "unknown")}</Text>
        {r.step ? (
          <Text type="supporting" color="secondary">
            {r.step}
          </Text>
        ) : null}
      </Stack>
    ),
  },
  { key: "model", header: "Model", render: (r) => <Text maxLines={1}>{r.model}</Text> },
  {
    key: "totalTokens",
    header: "Tokens",
    align: "end",
    render: (r) =>
      r.cachedTokens
        ? `${formatCount(r.totalTokens)} (${formatCount(r.cachedTokens)} cached)`
        : formatCount(r.totalTokens),
  },
  { key: "durationMs", header: "Time", align: "end", render: (r) => formatMs(r.durationMs) },
  {
    key: "costNanos",
    header: "Cost",
    align: "end",
    render: (r) => (r.priced ? formatUSD(r.costNanos) : "—"),
  },
  {
    key: "status",
    header: "Status",
    align: "end",
    render: (r) => (
      <Stack gap={1} hAlign="end">
        <StatusBadge entry={r} />
        {r.supportBy ? <Badge label="Support" variant="purple" /> : null}
      </Stack>
    ),
  },
];

/** One page of the user's model calls; a row opens everything recorded about the call. */
export function RecentCalls({
  entries,
  total,
  page,
  pageSize,
}: {
  entries: UsageEntry[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState<UsageEntry | null>(null);

  const goTo = (next: number) => {
    const search = new URLSearchParams(params.toString());
    search.set(CALLS_PAGE_PARAM, String(next));
    router.push(`${pathname}?${search.toString()}`, { scroll: false });
  };

  return (
    <SectionCard title="Model calls" description={`${formatCount(total)} recorded, newest first.`}>
      <Stack gap={4}>
        <Table
          variant="plain"
          density="compact"
          columns={columns}
          rows={entries}
          rowKey={(r) => r.id}
          onRowClick={setOpen}
          empty="No model calls yet."
        />
        {total > pageSize ? (
          <Pagination
            page={page}
            onChange={goTo}
            totalItems={total}
            pageSize={pageSize}
            variant="count"
            size="sm"
          />
        ) : null}
      </Stack>
      <Drawer
        isOpen={open !== null}
        onOpenChange={(isOpen) => !isOpen && setOpen(null)}
        title={open ? featureLabel(open.feature || "unknown") : "Call"}
        subtitle={open ? formatDateTime(open.createdAt) : undefined}
        headerStart={open ? <StatusBadge entry={open} /> : undefined}
      >
        {open ? <CallDetail entry={open} /> : null}
      </Drawer>
    </SectionCard>
  );
}

function CallDetail({ entry }: { entry: UsageEntry }) {
  return (
    <Stack gap={5}>
      {entry.error ? <Text color="secondary">{entry.error}</Text> : null}
      <MetadataList title="Call">
        <MetadataListItem label="Model">{entry.model}</MetadataListItem>
        <MetadataListItem label="Step">{entry.step || "—"}</MetadataListItem>
        <MetadataListItem label="Route">{entry.route || "—"}</MetadataListItem>
        <MetadataListItem label="Client">
          {entry.client ? `${clientLabel(entry.client)} ${entry.clientVersion}`.trim() : "—"}
        </MetadataListItem>
        <MetadataListItem label="Chrome tab">{entry.tabKey || "—"}</MetadataListItem>
        <MetadataListItem label="Support session">{entry.supportBy || "No"}</MetadataListItem>
      </MetadataList>
      <MetadataList title="Outcome">
        <MetadataListItem label="Duration">{formatMs(entry.durationMs)}</MetadataListItem>
        <MetadataListItem label="Attempts">{String(entry.attempts)}</MetadataListItem>
        <MetadataListItem label="HTTP status">
          {entry.httpStatus ? String(entry.httpStatus) : "—"}
        </MetadataListItem>
        <MetadataListItem label="Finish reason">{entry.finishReason || "—"}</MetadataListItem>
      </MetadataList>
      <MetadataList title="Tokens and cost">
        <MetadataListItem label="Prompt">{formatCount(entry.promptTokens)}</MetadataListItem>
        <MetadataListItem label="Cached / written to cache">
          {`${formatCount(entry.cachedTokens)} / ${formatCount(entry.cacheWriteTokens)}`}
        </MetadataListItem>
        <MetadataListItem label="Completion">
          {formatCount(entry.completionTokens)}
        </MetadataListItem>
        <MetadataListItem label="Cost">
          {entry.priced ? formatUSD(entry.costNanos) : "Not priced"}
        </MetadataListItem>
      </MetadataList>
    </Stack>
  );
}
