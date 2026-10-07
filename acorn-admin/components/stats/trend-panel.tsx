"use client";

import { useState } from "react";
import { SectionCard, SegmentedControl, SegmentedControlItem, TrendChart } from "sid-ui";

import type { Point, Window } from "@/lib/statistics/types";

import { formatBucket, formatCount, formatMs, formatUSD } from "@/lib/format";

const CHART_HEIGHT = 260;

type Metric = "calls" | "cost" | "latency" | "users";

const METRICS: { value: Metric; label: string }[] = [
  { value: "calls", label: "Calls" },
  { value: "cost", label: "Spend" },
  { value: "latency", label: "Latency" },
  { value: "users", label: "Users" },
];

/** Calls and failures, spend, latency or active users over the period. */
export function TrendPanel({ series, window }: { series: Point[]; window: Window }) {
  const [metric, setMetric] = useState<Metric>("calls");
  const labels = series.map((p) => formatBucket(p.start, window.bucket));
  const chart = {
    calls: {
      series: [
        { label: "Succeeded", values: series.map((p) => p.ok), tone: "blue" as const },
        { label: "Failed", values: series.map((p) => p.errors), tone: "red" as const },
        { label: "Cancelled", values: series.map((p) => p.cancelled), tone: "neutral" as const },
      ],
      format: formatCount,
    },
    cost: {
      series: [{ label: "Spend", values: series.map((p) => p.costNanos), tone: "orange" as const }],
      format: formatUSD,
    },
    latency: {
      series: [
        { label: "p50", values: series.map((p) => p.p50Ms), tone: "blue" as const },
        { label: "p95", values: series.map((p) => p.p95Ms), tone: "purple" as const },
        { label: "p99", values: series.map((p) => p.p99Ms), tone: "red" as const },
      ],
      format: formatMs,
    },
    users: {
      series: [
        { label: "Active users", values: series.map((p) => p.activeUsers), tone: "green" as const },
      ],
      format: formatCount,
    },
  }[metric];

  return (
    <SectionCard
      title="Over time"
      description={window.bucket === "hour" ? "Hourly" : "Daily"}
      action={
        <SegmentedControl
          label="Metric"
          size="sm"
          value={metric}
          onChange={(v) => setMetric(v as Metric)}
        >
          {METRICS.map((m) => (
            <SegmentedControlItem key={m.value} value={m.value} label={m.label} />
          ))}
        </SegmentedControl>
      }
    >
      <TrendChart
        label={`${METRICS.find((m) => m.value === metric)?.label} over time`}
        labels={labels}
        series={chart.series}
        variant={metric === "latency" ? "line" : "area"}
        height={CHART_HEIGHT}
        formatValue={chart.format}
      />
    </SectionCard>
  );
}
