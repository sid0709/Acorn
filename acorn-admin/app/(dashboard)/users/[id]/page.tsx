import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GridColumn, GridSystem, Skeleton, Stack } from "sid-ui";

import type { Metadata } from "next";

import { filterOptions } from "@/components/stats/filter-options";
import { StatisticsDashboard } from "@/components/stats/statistics-dashboard";
import { StatsFilters } from "@/components/stats/stats-filters";
import { UserAudit, UserRecentCalls } from "@/components/users/user-activity";
import { UserHeader } from "@/components/users/user-header";
import { getUser } from "@/lib/api/users";
import { statsFilterFrom } from "@/lib/statistics/types";

/** Room the activity cards hold while they load, so nothing jumps when they arrive. */
const ACTIVITY_PLACEHOLDER_HEIGHT = 320;

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
  const detail = await getUser(id, filter);
  if (!detail) notFound();
  return (
    <Stack gap={6}>
      <UserHeader user={detail.user} />
      <StatsFilters filter={filter} {...filterOptions(detail.statistics)} />
      <StatisticsDashboard stats={detail.statistics} />
      <GridSystem gap={4} align="stretch">
        <GridColumn span="full" lg={8}>
          <Suspense key={callsPage} fallback={<Skeleton height={ACTIVITY_PLACEHOLDER_HEIGHT} />}>
            <UserRecentCalls id={id} page={callsPage} />
          </Suspense>
        </GridColumn>
        <GridColumn span="full" lg={4}>
          <Suspense fallback={<Skeleton height={ACTIVITY_PLACEHOLDER_HEIGHT} />}>
            <UserAudit id={id} />
          </Suspense>
        </GridColumn>
      </GridSystem>
    </Stack>
  );
}
