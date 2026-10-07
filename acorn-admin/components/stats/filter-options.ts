import type { Statistics } from "@/lib/statistics/types";

/** The model, feature and client keys a filter can pick from, out of the period's breakdowns. */
export function filterOptions(stats: Statistics) {
  const keys = (groups: { key: string }[]) =>
    groups.map((g) => g.key).filter((k) => k !== "unknown");
  return {
    models: keys(stats.byModel),
    features: keys(stats.byFeature),
    clients: keys(stats.byClient),
  };
}
