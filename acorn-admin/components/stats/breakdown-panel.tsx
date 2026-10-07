"use client";

import { useState } from "react";
import {
  Badge,
  SectionCard,
  SegmentedControl,
  SegmentedControlItem,
  Table,
  Text,
  type TableColumn,
} from "sid-ui";

import type { Group } from "@/lib/statistics/types";

import { formatCount, formatMs, formatPercent, formatUSD } from "@/lib/format";
import { clientLabel, featureLabel } from "@/lib/statistics/labels";

const PAGE_SIZE = 8;
/** A success rate under this reads as a warning in the table. */
const SUCCESS_WARN = 0.95;

type By = "model" | "feature" | "step" | "client";

const VIEWS: { value: By; label: string; name: (k: string) => string }[] = [
  { value: "model", label: "Models", name: (k) => k },
  { value: "feature", label: "Features", name: featureLabel },
  { value: "step", label: "Steps", name: (k) => k },
  { value: "client", label: "Clients", name: clientLabel },
];

type Row = Group & { name: string };

const columns: TableColumn<Row>[] = [
  {
    key: "name",
    header: "Name",
    sortable: true,
    render: (r) => <Text weight="medium">{r.name}</Text>,
  },
  {
    key: "calls",
    header: "Calls",
    align: "end",
    sortable: true,
    render: (r) => formatCount(r.calls),
  },
  {
    key: "successRate",
    header: "Success",
    align: "end",
    sortable: true,
    render: (r) => (
      <Badge
        label={formatPercent(r.successRate)}
        variant={
          r.successRate >= SUCCESS_WARN
            ? "success"
            : r.calls - r.cancelled > 0
              ? "warning"
              : "neutral"
        }
      />
    ),
  },
  { key: "p50Ms", header: "p50", align: "end", sortable: true, render: (r) => formatMs(r.p50Ms) },
  { key: "p95Ms", header: "p95", align: "end", sortable: true, render: (r) => formatMs(r.p95Ms) },
  {
    key: "avgTokensPerCall",
    header: "Tokens / call",
    align: "end",
    sortable: true,
    render: (r) => formatCount(Math.round(r.avgTokensPerCall)),
  },
  {
    key: "cacheHitRate",
    header: "Cache hits",
    align: "end",
    sortable: true,
    render: (r) => formatPercent(r.cacheHitRate),
  },
  {
    key: "retryRate",
    header: "Retried",
    align: "end",
    sortable: true,
    render: (r) => formatPercent(r.retryRate),
  },
  {
    key: "costNanos",
    header: "Spend",
    align: "end",
    sortable: true,
    render: (r) => formatUSD(r.costNanos),
  },
  {
    key: "costPerCallNanos",
    header: "Per call",
    align: "end",
    sortable: true,
    render: (r) => formatUSD(r.costPerCallNanos),
  },
];

/** Every metric per model, feature, step or client, sortable. */
export function BreakdownPanel({ groups }: { groups: Record<By, Group[]> }) {
  const [by, setBy] = useState<By>("model");
  const view = VIEWS.find((v) => v.value === by) ?? VIEWS[0];
  const rows: Row[] = groups[by].map((g) => ({ ...g, name: view.name(g.key) }));
  return (
    <SectionCard
      title="Breakdown"
      description="Latency is from successful calls; success excludes cancels."
      action={
        <SegmentedControl label="Group by" size="sm" value={by} onChange={(v) => setBy(v as By)}>
          {VIEWS.map((v) => (
            <SegmentedControlItem key={v.value} value={v.value} label={v.label} />
          ))}
        </SegmentedControl>
      }
    >
      <Table
        variant="plain"
        density="compact"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        pageSize={PAGE_SIZE}
        defaultSort={{ key: "calls", direction: "desc" }}
        empty="No calls in this period."
      />
    </SectionCard>
  );
}
