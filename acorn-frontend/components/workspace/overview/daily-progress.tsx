"use client";

import {
  Banner,
  EmptyState,
  Glyph,
  Grid,
  KpiWidget,
  SectionCard,
  Stack,
  TrendChart,
  type KpiDelta,
} from "sid-ui";
import { useToday } from "@/components/workspace/use-today";
import type { Day } from "@/lib/workspace/dates";
import {
  countChange,
  dailyProgress,
  formatCost,
  formatWorked,
  type RunProgressData,
} from "@/lib/workspace/progress";
import { RANGES, deltaOf, type RangeValue } from "@/lib/workspace/stats";
import { RecentRunsTable } from "./recent-runs-table";

const KPI_MIN_WIDTH = 200;
const KPI_COLUMNS = 4;
const CHART_HEIGHT = 260;

/** A change that is neither good nor bad (more applications cost more): same figure, quiet colour. */
function quiet(delta: KpiDelta | undefined): KpiDelta | undefined {
  return delta && { ...delta, direction: "flat" };
}

/**
 * Daily progress: how many applications Acorn sent for you each day, what they took and cost,
 * and the newest ones with the link of each job. Real numbers, from the Runs that ended sent.
 */
export function DailyProgress({
  progress,
  range,
  serverToday,
}: {
  progress: RunProgressData;
  range: RangeValue;
  serverToday: Day;
}) {
  const today = useToday(serverToday);
  if (!progress.ok) {
    return (
      <Banner
        status="error"
        title="Daily progress isn’t available right now"
        description={progress.message}
      />
    );
  }

  const view = dailyProgress(progress.days, today, range);
  const rangeLabel = RANGES.find((option) => option.value === range)?.label.toLowerCase();
  const { current, previous } = view;

  if (!view.hasAny) {
    return (
      <SectionCard
        title="Daily progress"
        description="Applications Acorn sent for you, day by day."
      >
        <EmptyState
          icon={<Glyph name="sparkle" />}
          title="No applications counted yet"
          description="When Acorn finishes an application for you, it is counted here: the day it went in, the link of the job, how long it took and what it cost. Open a job page and press Run in the Acorn side panel."
        />
      </SectionCard>
    );
  }

  return (
    <Stack gap={6}>
      <SectionCard
        title="Daily progress"
        description={`Applications Acorn sent for you, day by day, over the last ${rangeLabel}.`}
      >
        <Stack gap={4}>
          <Grid columns={{ minWidth: KPI_MIN_WIDTH, max: KPI_COLUMNS }} gap={4}>
            <KpiWidget
              label="Sent today"
              value={String(view.sentToday)}
              delta={countChange(view.sentToday, view.sentYesterday)}
              hint={`${view.sentYesterday} yesterday`}
            />
            <KpiWidget
              label={`Sent in ${rangeLabel}`}
              value={String(current.sent)}
              delta={deltaOf(current.sent, previous.sent)}
              hint={`${current.activeDays} active days · longest streak ${view.bestStreak}`}
            />
            <KpiWidget
              label="Time per application"
              value={formatWorked(current.avgDurationMs)}
              delta={
                current.avgDurationMs !== null && previous.avgDurationMs !== null
                  ? deltaOf(current.avgDurationMs, previous.avgDurationMs, { lowerIsBetter: true })
                  : undefined
              }
              hint="Working time. Waiting for you is left out."
            />
            <KpiWidget
              label="Spent"
              value={formatCost(current.costNanos)}
              delta={quiet(deltaOf(current.costNanos, previous.costNanos))}
              hint={
                current.avgCostNanos === null
                  ? "Nothing sent in this period"
                  : `${formatCost(current.avgCostNanos)} per application`
              }
            />
          </Grid>
          <TrendChart
            label="Applications sent per day"
            labels={view.labels}
            series={[{ label: "Sent", values: view.counts }]}
            height={CHART_HEIGHT}
          />
        </Stack>
      </SectionCard>
      <SectionCard
        title="Sent by Acorn"
        description="Newest first: the link of each job, when it went in, how long it took and what it cost."
      >
        <RecentRunsTable runs={progress.recent} />
      </SectionCard>
    </Stack>
  );
}
