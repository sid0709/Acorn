export type BackoffOptions = {
  baseMs: number;
  maxMs: number;
  /** 0–1: the delay is spread ± this fraction so clients don't retry in lockstep. */
  jitter: number;
};

/** Exponential backoff with jitter for retry `attempt` (0-based), capped at `maxMs`. */
export function nextRetryDelay(
  attempt: number,
  { baseMs, maxMs, jitter }: BackoffOptions,
  random: () => number = Math.random,
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  const spread = exp * jitter * (random() * 2 - 1);
  return Math.round(Math.min(maxMs, Math.max(baseMs, exp + spread)));
}
