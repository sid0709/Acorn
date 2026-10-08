/** acorn-backend's statistics (aiusage.Statistics and acornapi admin_stats.go). */

export type Summary = {
  calls: number;
  ok: number;
  errors: number;
  cancelled: number;
  successRate: number;
  errorRate: number;
  cancelRate: number;
  activeUsers: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cacheHitRate: number;
  avgTokensPerCall: number;
  costNanos: number;
  costPerCallNanos: number;
  costPerSuccessNanos: number;
  costPerUserNanos: number;
  costPer1kTokensNanos: number;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  tokensPerSecond: number;
  retryRate: number;
  truncationRate: number;
  emptyRate: number;
};

export type Group = Summary & { key: string };
export type Point = Summary & { start: string };

export type HotTab = {
  accountId: string;
  tabKey: string;
  peakCalls: number;
  bursts: number;
  burstCalls: number;
  costNanos: number;
  first: string;
  last: string;
};

export type SLOStatus = "met" | "at_risk" | "breached" | "no_data";

export type SLO = {
  key: string;
  label: string;
  comparator: "at_least" | "at_most";
  unit: "rate" | "ms";
  target: number;
  actual: number;
  status: SLOStatus;
};

export type Window = { from: string; to: string; bucket: "hour" | "day" };

export type Statistics = {
  range: StatsRange;
  current: Window;
  previous: Window;
  summary: Summary;
  previousSummary: Summary;
  engagement: { dau: number; wau: number; mau: number; stickiness: number };
  series: Point[];
  byModel: Group[];
  byFeature: Group[];
  byStep: Group[];
  byClient: Group[];
  byErrorKind: Group[];
  topUsers: Group[];
  hotTabs: HotTab[];
  loopRule: { calls: number; minutes: number };
  slos: SLO[];
};

export type Growth = { signups: number; activated: number; activationRate: number };
export type AccountNames = Record<
  string,
  { name: string; email: string; deactivatedAt?: string | null }
>;

export const STATS_RANGES = ["24h", "7d", "30d", "90d"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];
export const DEFAULT_RANGE: StatsRange = "7d";

export const STATS_RANGE_LABEL: Record<StatsRange, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

/** The statistics filters, as the URL carries them. */
export type StatsFilter = {
  range: StatsRange;
  model?: string;
  feature?: string;
  client?: string;
  includeSupport?: boolean;
};

export const STATS_PARAM = {
  range: "range",
  model: "model",
  feature: "feature",
  client: "client",
  includeSupport: "includeSupport",
} as const;

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.trim() || undefined;
}

/** Reads the filters from a page's search params. */
export function statsFilterFrom(params: SearchParams): StatsFilter {
  const range = one(params[STATS_PARAM.range]);
  return {
    range: (STATS_RANGES as readonly string[]).includes(range ?? "")
      ? (range as StatsRange)
      : DEFAULT_RANGE,
    model: one(params[STATS_PARAM.model]),
    feature: one(params[STATS_PARAM.feature]),
    client: one(params[STATS_PARAM.client]),
    includeSupport: one(params[STATS_PARAM.includeSupport]) === "true",
  };
}
