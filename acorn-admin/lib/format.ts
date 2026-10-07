import type { KpiDelta } from "sid-ui";

const NANOS_PER_DOLLAR = 1_000_000_000;
/** Below this relative change a delta reads as flat. */
const FLAT_CHANGE = 0.005;

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-US");
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const hour = new Intl.DateTimeFormat("en-US", { hour: "numeric" });
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function formatCount(n: number): string {
  return n >= 10_000 ? compact.format(n) : whole.format(n);
}

export function formatPercent(rate: number, digits = 1): string {
  if (!Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

export function formatMs(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Nanodollars as dollars, with more digits for the tiny amounts one call costs. */
export function formatUSD(nanos: number): string {
  const dollars = nanos / NANOS_PER_DOLLAR;
  if (dollars === 0) return "$0";
  if (Math.abs(dollars) >= 1) return `$${dollars.toFixed(2)}`;
  if (Math.abs(dollars) >= 0.01) return `$${dollars.toFixed(3)}`;
  return `$${dollars.toPrecision(2)}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : "—";
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? date.format(new Date(iso)) : "—";
}

/** A series bucket's axis label: the hour for hourly buckets, the date otherwise. */
export function formatBucket(iso: string, bucket: "hour" | "day"): string {
  return (bucket === "hour" ? hour : day).format(new Date(iso));
}

/**
 * The change from previous to current as a KPI badge. `higherIsBetter` decides
 * whether a rise is shown as good or bad; a rate compares in points.
 */
export function formatDelta(
  current: number,
  previous: number,
  { higherIsBetter = true, isRate = false } = {},
): KpiDelta | undefined {
  if (!previous && !current) return undefined;
  if (isRate) {
    const points = (current - previous) * 100;
    if (Math.abs(points) < FLAT_CHANGE * 100) return { value: "±0 pts", direction: "flat" };
    const good = points > 0 === higherIsBetter;
    return {
      value: `${points > 0 ? "+" : ""}${points.toFixed(1)} pts`,
      direction: good ? "up" : "down",
    };
  }
  if (!previous) return { value: "New", direction: "flat" };
  const change = (current - previous) / previous;
  if (Math.abs(change) < FLAT_CHANGE) return { value: "±0%", direction: "flat" };
  const good = change > 0 === higherIsBetter;
  return {
    value: `${change > 0 ? "+" : ""}${(change * 100).toFixed(0)}%`,
    direction: good ? "up" : "down",
  };
}
