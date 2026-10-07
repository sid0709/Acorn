import { adminJSON, query } from "./client";

import type { AccountNames, Growth, Statistics, StatsFilter } from "../statistics/types";

export const STATISTICS_PATH = "/acorn/admin/statistics";

export type StatisticsResponse = { statistics: Statistics; growth: Growth; accounts: AccountNames };

/** Filters as acorn-backend's query string (acornapi statsFilter). */
export function statsQuery(filter: StatsFilter, extra: Record<string, string> = {}): string {
  return query({
    range: filter.range,
    model: filter.model,
    feature: filter.feature,
    client: filter.client,
    includeSupport: filter.includeSupport,
    ...extra,
  });
}

/** acorn-backend predates this console when its statistics lack the series and breakdowns. */
export const OUTDATED_BACKEND =
  "acorn-backend is older than this console. Restart it (bun run dev:acorn-api) and reload.";

export function assertCurrentStatistics(stats: Statistics | undefined): Statistics {
  if (!stats || !Array.isArray(stats.series) || !Array.isArray(stats.byModel) || !stats.summary) {
    throw new Error(OUTDATED_BACKEND);
  }
  return stats;
}

export async function fetchStatistics(filter: StatsFilter): Promise<StatisticsResponse> {
  const body = await adminJSON<StatisticsResponse>(`${STATISTICS_PATH}${statsQuery(filter)}`);
  if (!body) throw new Error("Statistics are not available.");
  assertCurrentStatistics(body.statistics);
  return {
    ...body,
    growth: body.growth ?? { signups: 0, activated: 0, activationRate: 0 },
    accounts: body.accounts ?? {},
  };
}
