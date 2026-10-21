"use client";

import { useState } from "react";
import {
  Button,
  Glyph,
  HStack,
  PageHeader,
  SectionCard,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Text,
  TrendChart,
} from "sid-ui";
import type { AcornAccount } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";
import type { Activity } from "@/lib/workspace/activity";
import { firstName } from "@/lib/workspace/model";
import type { RunProgressData } from "@/lib/workspace/progress";
import {
  DEFAULT_RANGE,
  RANGES,
  previousWindow,
  recentApplications,
  summarize,
  weekly,
  windowFor,
  type RangeValue,
} from "@/lib/workspace/stats";
import { DailyProgress } from "./overview/daily-progress";
import { FullAnalytics } from "./overview/full-analytics";
import { HeroMetrics } from "./overview/hero-metrics";
import { KpiRow } from "./overview/kpi-row";
import { RecentTable } from "./overview/recent-table";

const RECENT_ROWS = 24;

/**
 * Statistics: daily progress (real: the applications Acorn sent), then two headline numbers, one
 * chart, the recent applications, and the deeper charts (still samples until replies are tracked).
 */
export function OverviewPanel({
  account,
  activity,
  progress,
}: {
  account: AcornAccount;
  activity: Activity;
  progress: RunProgressData;
}) {
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);
  const { today, applications } = activity;

  const period = windowFor(range, today);
  const current = summarize(applications, period);
  const previous = summarize(applications, previousWindow(period));
  const trend = weekly(applications, range, today);

  return (
    <Stack gap={6}>
      <PageHeader
        title={`Welcome back, ${firstName(account.name)}.`}
        description="How your search is going: what Acorn sent, who wrote back, and what comes next."
        action={
          <HStack gap={3} vAlign="center" wrap="wrap">
            <SegmentedControl
              label="Date range"
              value={range}
              onChange={(value) => setRange(value as RangeValue)}
            >
              {RANGES.map((option) => (
                <SegmentedControlItem
                  key={option.value}
                  value={option.value}
                  label={option.label}
                />
              ))}
            </SegmentedControl>
            <Button
              label="New résumé"
              variant="primary"
              href={ROUTES.resume}
              icon={<Glyph name="sparkle" />}
            />
          </HStack>
        }
      />
      <DailyProgress progress={progress} range={range} serverToday={today} />
      <HeroMetrics current={current} previous={previous} trend={trend} />
      <KpiRow current={current} previous={previous} trend={trend} />
      <SectionCard
        title="Activity over time"
        description="Applications sent and replies received, per week."
      >
        <TrendChart
          label="Applications and replies per week"
          labels={trend.labels}
          series={[
            { label: "Applied", values: trend.applied },
            { label: "Replies", values: trend.replies },
          ]}
          height={260}
        />
      </SectionCard>
      <SectionCard
        title="Recent applications"
        description="Newest activity first. Sort any column."
      >
        <RecentTable
          applications={recentApplications(applications, today, RECENT_ROWS)}
          today={today}
        />
      </SectionCard>
      <FullAnalytics applications={applications} period={period} />
      <Text type="supporting" color="secondary">
        Daily progress counts the applications Acorn really sent. The cards marked Sample update
        once Acorn tracks replies. Figures cover{" "}
        {RANGES.find((option) => option.value === range)?.label.toLowerCase()} ending today and
        compare against the same length of time before it.
      </Text>
    </Stack>
  );
}
