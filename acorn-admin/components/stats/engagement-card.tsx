import { MetadataList, MetadataListItem, SectionCard } from "sid-ui";

import type { Growth, Statistics } from "@/lib/statistics/types";

import { formatCount, formatPercent, formatUSD } from "@/lib/format";

/** Who uses AI and how often, sign-ups in the period, and what each user costs. */
export function EngagementCard({ stats, growth }: { stats: Statistics; growth: Growth }) {
  const { engagement, summary } = stats;
  return (
    <SectionCard
      title="Engagement"
      description="DAU, WAU and MAU count people with at least one AI call."
    >
      <MetadataList columns={2}>
        <MetadataListItem label="Daily active">{formatCount(engagement.dau)}</MetadataListItem>
        <MetadataListItem label="Weekly active">{formatCount(engagement.wau)}</MetadataListItem>
        <MetadataListItem label="Monthly active">{formatCount(engagement.mau)}</MetadataListItem>
        <MetadataListItem label="Stickiness (DAU / MAU)">
          {formatPercent(engagement.stickiness)}
        </MetadataListItem>
        <MetadataListItem label="New sign-ups">{formatCount(growth.signups)}</MetadataListItem>
        <MetadataListItem label="Activated (used AI)">
          {`${formatCount(growth.activated)} · ${formatPercent(growth.activationRate)}`}
        </MetadataListItem>
        <MetadataListItem label="Calls per active user">
          {summary.activeUsers ? (summary.calls / summary.activeUsers).toFixed(1) : "—"}
        </MetadataListItem>
        <MetadataListItem label="Spend per successful call">
          {formatUSD(summary.costPerSuccessNanos)}
        </MetadataListItem>
      </MetadataList>
    </SectionCard>
  );
}
