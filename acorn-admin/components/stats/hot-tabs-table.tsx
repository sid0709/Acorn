"use client";

import { useRouter } from "next/navigation";
import { Badge, SectionCard, Stack, Table, Text, type TableColumn } from "sid-ui";

import type { AccountNames, HotTab, Statistics } from "@/lib/statistics/types";

import { formatCount, formatDateTime, formatUSD } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

type Row = HotTab & { name: string };

const columns: TableColumn<Row>[] = [
  {
    key: "name",
    header: "Tab",
    render: (r) => (
      <Stack gap={0}>
        <Text weight="medium" maxLines={1}>
          {r.name}
        </Text>
        <Text type="supporting" color="secondary" maxLines={1}>
          {r.tabKey}
        </Text>
      </Stack>
    ),
  },
  {
    key: "peakCalls",
    header: "Peak",
    align: "end",
    render: (r) => <Badge label={`${r.peakCalls} calls`} variant="error" />,
  },
  { key: "bursts", header: "Bursts", align: "end", render: (r) => formatCount(r.bursts) },
  { key: "costNanos", header: "Spend", align: "end", render: (r) => formatUSD(r.costNanos) },
  { key: "last", header: "Last", align: "end", render: (r) => formatDateTime(r.last) },
];

/** Tabs that made a burst of calls in a few minutes: likely model-call loops. */
export function HotTabsTable({
  tabs,
  rule,
  accounts,
}: {
  tabs: HotTab[];
  rule: Statistics["loopRule"];
  accounts: AccountNames;
}) {
  const router = useRouter();
  const rows: Row[] = tabs.map((t) => ({ ...t, name: accounts[t.accountId]?.name || t.accountId }));
  return (
    <SectionCard
      title="Possible loops"
      description={`Tabs with ${rule.calls}+ calls inside ${rule.minutes} minutes.`}
    >
      <Table
        variant="plain"
        density="compact"
        columns={columns}
        rows={rows}
        rowKey={(r) => `${r.accountId}:${r.tabKey}`}
        onRowClick={(r) => router.push(ROUTES.user(r.accountId))}
        empty="No runaway tabs. Nice."
      />
    </SectionCard>
  );
}
