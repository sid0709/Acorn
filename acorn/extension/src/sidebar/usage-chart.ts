import type { AiUsageEntry } from "./use-ai-usage";

/** Rectangle width maps to response time. */
export const USAGE_WIDTH_MIN_PX = 28;
export const USAGE_WIDTH_MAX_PX = 140;
export const USAGE_DURATION_CAP_MS = 120_000;

/** Rectangle height maps to price. */
export const USAGE_HEIGHT_MIN_PX = 36;
export const USAGE_HEIGHT_MAX_PX = 96;
export const USAGE_COST_CAP_NANOS = 50_000_000;

export function usageBarWidth(durationMs: number): number {
  const ms = Math.max(0, durationMs);
  const t = Math.min(1, ms / USAGE_DURATION_CAP_MS);
  return Math.round(USAGE_WIDTH_MIN_PX + t * (USAGE_WIDTH_MAX_PX - USAGE_WIDTH_MIN_PX));
}

export function usageBarHeight(costNanos: number, priced: boolean): number {
  if (!priced || costNanos <= 0) {
    return USAGE_HEIGHT_MIN_PX;
  }
  const t = Math.min(1, costNanos / USAGE_COST_CAP_NANOS);
  return Math.round(USAGE_HEIGHT_MIN_PX + t * (USAGE_HEIGHT_MAX_PX - USAGE_HEIGHT_MIN_PX));
}

/** Stable hue (0–359) from a usage row id for bar fill. */
export function usageBarHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

export function usageBarLabel(entry: AiUsageEntry): string {
  const model = entry.model || "Model";
  const price = entry.priced ? entry.price : "unpriced";
  return `${model}, ${price}`;
}
