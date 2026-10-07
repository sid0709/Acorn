import { GridColumn, GridSystem, Stack } from "sid-ui";

import { BreakdownPanel } from "./breakdown-panel";
import { EngagementCard } from "./engagement-card";
import { ErrorCard } from "./error-card";
import { HotTabsTable } from "./hot-tabs-table";
import { KpiRow } from "./kpi-row";
import { QualityCard } from "./quality-card";
import { SloCard } from "./slo-card";
import { TopUsersTable } from "./top-users-table";
import { TrendPanel } from "./trend-panel";

import type { AccountNames, Growth, Statistics } from "@/lib/statistics/types";

/**
 * Every AI usage view for one filter. The platform page adds people (engagement,
 * top users, loops); one user's page leaves them out.
 */
export function StatisticsDashboard({
  stats,
  people,
}: {
  stats: Statistics;
  people?: { growth: Growth; accounts: AccountNames };
}) {
  return (
    <Stack gap={4}>
      <KpiRow
        summary={stats.summary}
        previous={stats.previousSummary}
        series={stats.series}
        hidePeople={!people}
      />
      <GridSystem gap={4} align="stretch">
        <GridColumn span="full" lg={8}>
          <TrendPanel series={stats.series} window={stats.current} />
        </GridColumn>
        <GridColumn span="full" lg={4}>
          <SloCard slos={stats.slos} />
        </GridColumn>
        <GridColumn span="full">
          <BreakdownPanel
            groups={{
              model: stats.byModel,
              feature: stats.byFeature,
              step: stats.byStep,
              client: stats.byClient,
            }}
          />
        </GridColumn>
        <GridColumn span="full" lg={people ? 4 : 5}>
          <ErrorCard byErrorKind={stats.byErrorKind} summary={stats.summary} />
        </GridColumn>
        <GridColumn span="full" lg={people ? 4 : 7}>
          <QualityCard summary={stats.summary} />
        </GridColumn>
        {people ? (
          <>
            <GridColumn span="full" lg={4}>
              <EngagementCard stats={stats} growth={people.growth} />
            </GridColumn>
            <GridColumn span="full" lg={7}>
              <TopUsersTable groups={stats.topUsers} accounts={people.accounts} />
            </GridColumn>
            <GridColumn span="full" lg={5}>
              <HotTabsTable tabs={stats.hotTabs} rule={stats.loopRule} accounts={people.accounts} />
            </GridColumn>
          </>
        ) : null}
      </GridSystem>
    </Stack>
  );
}
