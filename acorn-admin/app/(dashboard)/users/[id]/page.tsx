import { notFound } from "next/navigation";
import { GridColumn, GridSystem, Stack } from "sid-ui";

import type { Metadata } from "next";

import { filterOptions } from "@/components/stats/filter-options";
import { StatisticsDashboard } from "@/components/stats/statistics-dashboard";
import { StatsFilters } from "@/components/stats/stats-filters";
import { AuditCard } from "@/components/users/audit-card";
import { RecentCalls } from "@/components/users/recent-calls";
import { UserHeader } from "@/components/users/user-header";
import { getUser, listUserAudit, listUserUsage } from "@/lib/api/users";
import { statsFilterFrom } from "@/lib/statistics/types";

export const metadata: Metadata = { title: "User" };

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const filter = statsFilterFrom(search);
  const callsPage = Number(search.calls) || 1;
  const [detail, calls, audit] = await Promise.all([
    getUser(id, filter),
    listUserUsage(id, callsPage),
    listUserAudit(id),
  ]);
  if (!detail) notFound();
  return (
    <Stack gap={6}>
      <UserHeader user={detail.user} />
      <StatsFilters filter={filter} {...filterOptions(detail.statistics)} />
      <StatisticsDashboard stats={detail.statistics} />
      <GridSystem gap={4} align="stretch">
        <GridColumn span="full" lg={8}>
          <RecentCalls
            entries={calls.entries}
            total={calls.total}
            page={calls.page}
            pageSize={calls.pageSize}
          />
        </GridColumn>
        <GridColumn span="full" lg={4}>
          <AuditCard entries={audit} />
        </GridColumn>
      </GridSystem>
    </Stack>
  );
}
