"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HStack, SegmentedControl, SegmentedControlItem, Selector, Switch } from "sid-ui";

import { clientLabel, featureLabel } from "@/lib/statistics/labels";
import {
  STATS_PARAM,
  STATS_RANGES,
  STATS_RANGE_LABEL,
  type StatsFilter,
} from "@/lib/statistics/types";

const ALL = "";
const SELECT_WIDTH = 180;

type Option = { value: string; label: string };

/** The filter's options: "All" plus every key seen, keeping the selected one. */
function options(
  all: string,
  keys: string[],
  selected: string | undefined,
  label: (k: string) => string,
) {
  const seen = new Set(keys);
  if (selected) seen.add(selected);
  return [
    { value: ALL, label: all },
    ...[...seen].sort().map((key) => ({ value: key, label: label(key) })),
  ] satisfies Option[];
}

/**
 * Range, model, feature and client filters, and whether support sessions count.
 * Each change rewrites the URL, so the page re-renders on the server and the view can be shared.
 */
export function StatsFilters({
  filter,
  models,
  features,
  clients,
}: {
  filter: StatsFilter;
  models: string[];
  features: string[];
  clients: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <HStack gap={3} vAlign="center" wrap="wrap">
      <SegmentedControl
        label="Range"
        size="sm"
        value={filter.range}
        onChange={(value) => set(STATS_PARAM.range, value)}
      >
        {STATS_RANGES.map((range) => (
          <SegmentedControlItem
            key={range}
            value={range}
            label={range}
            aria-label={STATS_RANGE_LABEL[range]}
          />
        ))}
      </SegmentedControl>
      <Selector
        label="Model"
        isLabelHidden
        size="sm"
        width={SELECT_WIDTH}
        value={filter.model ?? ALL}
        options={options("All models", models, filter.model, (k) => k)}
        onChange={(value) => set(STATS_PARAM.model, value)}
      />
      <Selector
        label="Feature"
        isLabelHidden
        size="sm"
        width={SELECT_WIDTH}
        value={filter.feature ?? ALL}
        options={options("All features", features, filter.feature, featureLabel)}
        onChange={(value) => set(STATS_PARAM.feature, value)}
      />
      <Selector
        label="Client"
        isLabelHidden
        size="sm"
        width={SELECT_WIDTH}
        value={filter.client ?? ALL}
        options={options("All clients", clients, filter.client, clientLabel)}
        onChange={(value) => set(STATS_PARAM.client, value)}
      />
      <Switch
        label="Include support sessions"
        value={Boolean(filter.includeSupport)}
        onChange={(checked) => set(STATS_PARAM.includeSupport, checked ? "true" : "")}
      />
    </HStack>
  );
}
