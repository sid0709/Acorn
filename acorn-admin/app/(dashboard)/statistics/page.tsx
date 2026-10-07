import { PageHeader, Stack } from "sid-ui";

import type { Metadata } from "next";

import { filterOptions } from "@/components/stats/filter-options";
import { StatisticsDashboard } from "@/components/stats/statistics-dashboard";
import { StatsFilters } from "@/components/stats/stats-filters";
import { fetchStatistics } from "@/lib/api/statistics";
import { STATS_RANGE_LABEL, statsFilterFrom } from "@/lib/statistics/types";

export const metadata: Metadata = { title: "Statistics" };

export default async function StatisticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filter = statsFilterFrom(await searchParams);
  const { statistics, growth, accounts } = await fetchStatistics(filter);
  return (
    <Stack gap={6}>
      <PageHeader
        title="AI usage"
        description={`Every model call across Acorn over the last ${STATS_RANGE_LABEL[filter.range]}, against the period before.`}
      />
      <StatsFilters filter={filter} {...filterOptions(statistics)} />
      <StatisticsDashboard stats={statistics} people={{ growth, accounts }} />
    </Stack>
  );
}
