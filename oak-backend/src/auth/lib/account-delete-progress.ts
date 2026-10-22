/** Progress payload for account cascade delete (SSE `progress` events). */
export type AccountDeletePhase =
  'verifying' | 'preparing' | 'firebase' | 'database' | 'account' | 'done';

export type AccountDeleteProgress = {
  phase: AccountDeletePhase;
  message: string;
  /** Items removed so far (files + DB rows + account). */
  removed: number;
  /** Estimated total items to remove. */
  total: number;
  /** 0–100. */
  percent: number;
};

export type AccountDeleteProgressFn = (
  progress: AccountDeleteProgress,
) => void | Promise<void>;

export function accountDeletePercent(removed: number, total: number): number {
  if (total <= 0) return removed > 0 ? 99 : 0;
  return Math.min(99, Math.round((removed / total) * 100));
}
