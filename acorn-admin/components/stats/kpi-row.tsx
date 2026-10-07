import { Grid, KpiWidget, Sparkline } from "sid-ui";

import type { Point, Summary } from "@/lib/statistics/types";

import { formatCount, formatDelta, formatMs, formatPercent, formatUSD } from "@/lib/format";

const KPI_MIN_WIDTH = 200;
const KPI_COLUMNS = 3;

/** The headline numbers, each against the period before and with its trend underneath. */
export function KpiRow({
  summary,
  previous,
  series,
  hidePeople = false,
}: {
  summary: Summary;
  previous: Summary;
  series: Point[];
  /** One user's page has no "active users" to count. */
  hidePeople?: boolean;
}) {
  const trend = (pick: (p: Point) => number) => series.map(pick);
  return (
    <Grid columns={{ minWidth: KPI_MIN_WIDTH, max: KPI_COLUMNS }} gap={4}>
      <KpiWidget
        label="Model calls"
        value={formatCount(summary.calls)}
        delta={formatDelta(summary.calls, previous.calls)}
        hint={`${formatCount(summary.errors)} failed · ${formatCount(summary.cancelled)} cancelled`}
      >
        <Sparkline label="Calls per bucket" values={trend((p) => p.calls)} />
      </KpiWidget>
      <KpiWidget
        label="Success rate"
        value={summary.calls ? formatPercent(summary.successRate) : "—"}
        delta={
          summary.calls
            ? formatDelta(summary.successRate, previous.successRate, { isRate: true })
            : undefined
        }
        hint="Of calls that were not cancelled"
      >
        <Sparkline
          label="Success rate per bucket"
          tone="green"
          values={trend((p) => (p.calls ? p.successRate : 0))}
        />
      </KpiWidget>
      {hidePeople ? (
        <KpiWidget
          label="Tokens"
          value={formatCount(summary.totalTokens)}
          delta={formatDelta(summary.totalTokens, previous.totalTokens, { higherIsBetter: false })}
          hint={`${Math.round(summary.avgTokensPerCall).toLocaleString()} per call`}
        >
          <Sparkline label="Tokens per bucket" tone="purple" values={trend((p) => p.totalTokens)} />
        </KpiWidget>
      ) : (
        <KpiWidget
          label="Active users"
          value={formatCount(summary.activeUsers)}
          delta={formatDelta(summary.activeUsers, previous.activeUsers)}
          hint={`${formatUSD(summary.costPerUserNanos)} AI spend per user`}
        >
          <Sparkline
            label="Active users per bucket"
            tone="purple"
            values={trend((p) => p.activeUsers)}
          />
        </KpiWidget>
      )}
      <KpiWidget
        label="AI spend"
        value={formatUSD(summary.costNanos)}
        delta={formatDelta(summary.costNanos, previous.costNanos, { higherIsBetter: false })}
        hint={`${formatUSD(summary.costPerCallNanos)} per call · ${formatUSD(summary.costPer1kTokensNanos)} per 1k tokens`}
      >
        <Sparkline label="Spend per bucket" tone="orange" values={trend((p) => p.costNanos)} />
      </KpiWidget>
      <KpiWidget
        label="p95 latency"
        value={formatMs(summary.p95Ms)}
        delta={
          summary.p95Ms
            ? formatDelta(summary.p95Ms, previous.p95Ms, { higherIsBetter: false })
            : undefined
        }
        hint={`p50 ${formatMs(summary.p50Ms)} · p99 ${formatMs(summary.p99Ms)}`}
      >
        <Sparkline label="p95 latency per bucket" tone="red" values={trend((p) => p.p95Ms)} />
      </KpiWidget>
      <KpiWidget
        label="Prompt cache hit rate"
        value={summary.promptTokens ? formatPercent(summary.cacheHitRate) : "—"}
        delta={
          summary.promptTokens
            ? formatDelta(summary.cacheHitRate, previous.cacheHitRate, { isRate: true })
            : undefined
        }
        hint={`${formatCount(summary.cachedTokens)} of ${formatCount(summary.promptTokens)} prompt tokens`}
      >
        <Sparkline
          label="Cache hit rate per bucket"
          tone="green"
          values={trend((p) => p.cacheHitRate)}
        />
      </KpiWidget>
    </Grid>
  );
}
