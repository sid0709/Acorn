/** Token usage + estimated USD cost returned by ai-backend. */

export interface AiUsageSummary {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  /** Estimated USD from OpenAI list prices; null if model unknown. */
  costUsd: number | null;
  priced?: boolean;
  pricingNote?: string;
  calls?: number;
}

/** Nanodollars in a dollar: `acorn_ai_usage.costNanos` and a Run's `costNanos`. */
export const NANOS_PER_USD = 1_000_000_000;

/** A backend cost in nanodollars as dollars, e.g. `$0.0042`. */
export function formatNanosUsd(costNanos: number | null | undefined): string {
  if (costNanos == null || !Number.isFinite(costNanos)) return "$?";
  return formatUsd(costNanos / NANOS_PER_USD);
}

export function formatUsd(costUsd: number | null | undefined): string {
  if (costUsd == null || !Number.isFinite(costUsd)) return "$?";
  if (costUsd >= 1) return `$${costUsd.toFixed(2)}`;
  if (costUsd >= 0.01) return `$${costUsd.toFixed(3)}`;
  if (costUsd >= 0.001) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(5)}`;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${String(sec).padStart(2, "0")}s`;
}
