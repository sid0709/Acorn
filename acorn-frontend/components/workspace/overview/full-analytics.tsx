"use client";

import { useState } from "react";
import {
  BarChart,
  Collapsible,
  DonutChart,
  FunnelChart,
  GridColumn,
  GridSystem,
  HeatmapCalendar,
  SectionCard,
  SegmentedControl,
  SegmentedControlItem,
  Text,
} from "sid-ui";
import type { Application } from "@/lib/workspace/applications";
import {
  byWeekday,
  bySource,
  dailyActivity,
  funnel,
  habits,
  replyRateBySource,
  stageMix,
  type Window,
} from "@/lib/workspace/stats";

const percent = (value: number) => `${value}%`;

/** The deeper charts, one click away so they stay off the default scroll path. */
export function FullAnalytics({
  applications,
  period,
}: {
  applications: Application[];
  period: Window;
}) {
  const [sourceView, setSourceView] = useState<"volume" | "rate">("volume");
  const days = dailyActivity(applications, period);
  const rhythm = habits(days);
  const weekdays = byWeekday(applications, period);
  const busiest = weekdays.reduce(
    (best, day) => (day.value > best.value ? day : best),
    weekdays[0],
  );

  return (
    <Collapsible defaultIsOpen={false} trigger={<Text weight="semibold">View full analytics</Text>}>
      <GridSystem gap={4} align="stretch">
        <GridColumn span="full" lg={4}>
          <SectionCard
            title="Where they stand"
            description="Applications sent in this period, by status."
          >
            <DonutChart
              label="Applications by status"
              centerLabel="Applications"
              data={stageMix(applications, period)}
              size={152}
            />
          </SectionCard>
        </GridColumn>
        <GridColumn span="full" lg={8}>
          <SectionCard
            title="Pipeline"
            description="Jobs saved in this period and how far each got. The percentage is from the step above."
          >
            <FunnelChart label="Application pipeline" stages={funnel(applications, period)} />
          </SectionCard>
        </GridColumn>
        <GridColumn span="full" lg={5}>
          <SectionCard
            title="Sources"
            description={
              sourceView === "volume"
                ? "Where Acorn applied."
                : "Share of applications that got a reply."
            }
            action={
              <SegmentedControl
                label="Source measure"
                size="sm"
                value={sourceView}
                onChange={(value) => setSourceView(value as "volume" | "rate")}
              >
                <SegmentedControlItem value="volume" label="Volume" />
                <SegmentedControlItem value="rate" label="Reply rate" />
              </SegmentedControl>
            }
          >
            {sourceView === "volume" ? (
              <BarChart
                label="Applications by source"
                orientation="bars"
                data={bySource(applications, period)}
              />
            ) : (
              <BarChart
                label="Reply rate by source"
                orientation="bars"
                tone="orange"
                data={replyRateBySource(applications, period)}
                formatValue={percent}
              />
            )}
          </SectionCard>
        </GridColumn>
        <GridColumn span="full" lg={7}>
          <SectionCard
            title="Daily rhythm"
            description={`Active on ${rhythm.activeDays} of ${rhythm.totalDays} days · longest streak ${rhythm.bestStreak} days · current streak ${rhythm.currentStreak}`}
          >
            <HeatmapCalendar label="Applications per day" unit="applications" days={days} />
          </SectionCard>
        </GridColumn>
        <GridColumn span="full">
          <SectionCard
            title="By weekday"
            description={
              busiest.value > 0
                ? `${busiest.label} is your busiest day.`
                : "No applications in this period."
            }
          >
            <BarChart label="Applications by weekday" data={weekdays} height={180} />
          </SectionCard>
        </GridColumn>
      </GridSystem>
    </Collapsible>
  );
}
