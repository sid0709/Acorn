"use client";

import { BarChart, MetadataList, MetadataListItem, SectionCard, Stack } from "sid-ui";

import type { Summary } from "@/lib/statistics/types";

import { formatCount, formatMs, formatPercent } from "@/lib/format";

const CHART_HEIGHT = 160;

/** Latency spread and the answer-quality signals: retries, truncation, empty answers, throughput. */
export function QualityCard({ summary }: { summary: Summary }) {
  return (
    <SectionCard title="Latency and answer quality" description="From successful calls.">
      <Stack gap={5}>
        <BarChart
          label="Latency percentiles"
          height={CHART_HEIGHT}
          tone="purple"
          formatValue={formatMs}
          data={[
            { label: "avg", value: summary.avgMs },
            { label: "p50", value: summary.p50Ms },
            { label: "p90", value: summary.p90Ms },
            { label: "p95", value: summary.p95Ms },
            { label: "p99", value: summary.p99Ms },
          ]}
        />
        <MetadataList columns={2}>
          <MetadataListItem label="Throughput">{`${summary.tokensPerSecond.toFixed(1)} tokens/s`}</MetadataListItem>
          <MetadataListItem label="Calls needing a retry">
            {formatPercent(summary.retryRate)}
          </MetadataListItem>
          <MetadataListItem label="Truncated answers">
            {formatPercent(summary.truncationRate)}
          </MetadataListItem>
          <MetadataListItem label="Empty answers">
            {formatPercent(summary.emptyRate)}
          </MetadataListItem>
          <MetadataListItem label="Prompt / completion">
            {`${formatCount(summary.promptTokens)} / ${formatCount(summary.completionTokens)}`}
          </MetadataListItem>
          <MetadataListItem label="Cache writes">
            {formatCount(summary.cacheWriteTokens)}
          </MetadataListItem>
        </MetadataList>
      </Stack>
    </SectionCard>
  );
}
