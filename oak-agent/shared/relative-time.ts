const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** "now", "5m", "3h", "2d" for the last week, then the date. */
export function formatRelativeTime(at: number, now: number = Date.now()): string {
  const age = Math.max(0, now - at);
  if (age < MINUTE_MS) return "now";
  if (age < HOUR_MS) return `${Math.floor(age / MINUTE_MS)}m`;
  if (age < DAY_MS) return `${Math.floor(age / HOUR_MS)}h`;
  if (age < WEEK_MS) return `${Math.floor(age / DAY_MS)}d`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
