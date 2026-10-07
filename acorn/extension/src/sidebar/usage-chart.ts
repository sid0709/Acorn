import { CHART_TONES, type ChartTone } from "sid-ui";

import type { AiUsageEntry } from "./use-ai-usage";

/** Mark width maps to response time, relative to the slowest call shown. */
export const USAGE_WIDTH_MIN_PX = 10;
export const USAGE_WIDTH_MAX_PX = 64;

/** Mark height maps to cost, as a share of the plot, relative to the costliest call shown. */
export const USAGE_HEIGHT_MIN_PCT = 8;
export const USAGE_HEIGHT_MAX_PCT = 100;

/** Failed calls stand out in the chart's red, whatever their model. */
export const USAGE_FAILED_TONE: ChartTone = "red";

export type UsageScale = { maxDurationMs: number; maxCostNanos: number };

export function usageScale(entries: AiUsageEntry[]): UsageScale {
  return {
    maxDurationMs: Math.max(0, ...entries.map((e) => e.durationMs || 0)),
    maxCostNanos: Math.max(0, ...entries.map((e) => (e.priced ? e.costNanos : 0))),
  };
}

function share(value: number, max: number): number {
  return max > 0 ? Math.min(1, Math.max(0, value) / max) : 0;
}

export function usageBarWidth(durationMs: number, scale: UsageScale): number {
  const t = share(durationMs, scale.maxDurationMs);
  return Math.round(USAGE_WIDTH_MIN_PX + t * (USAGE_WIDTH_MAX_PX - USAGE_WIDTH_MIN_PX));
}

export function usageBarHeight(entry: AiUsageEntry, scale: UsageScale): number {
  const t = entry.priced ? share(entry.costNanos, scale.maxCostNanos) : 0;
  return Math.round(USAGE_HEIGHT_MIN_PCT + t * (USAGE_HEIGHT_MAX_PCT - USAGE_HEIGHT_MIN_PCT));
}

/** Oldest first, so each new call joins on the right. */
export function chronological(entries: AiUsageEntry[]): AiUsageEntry[] {
  return [...entries].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** One sid-ui chart tone per model, in order of first use. */
export function modelTones(entries: AiUsageEntry[]): Map<string, ChartTone> {
  const tones = new Map<string, ChartTone>();
  for (const entry of entries) {
    const model = entry.model || "Model";
    if (!tones.has(model)) tones.set(model, CHART_TONES[tones.size % CHART_TONES.length]);
  }
  return tones;
}

/** The model's short name: "typesafe/jev-1.13" reads as "jev-1.13". */
export function shortModel(model: string): string {
  return model.split("/").pop() || model || "Model";
}

export function usageBarLabel(entry: AiUsageEntry): string {
  const model = entry.model || "Model";
  const price = entry.priced ? entry.price : "unpriced";
  return `${model}, ${price}`;
}
