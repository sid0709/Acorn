import { useEffect, useState } from "react";
import { Text } from "sid-ui";

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1_000;

const pad = (value: number, width: number) => String(value).padStart(width, "0");

/** Elapsed time as hours:minutes:seconds:milliseconds, e.g. 00:01:07:042. */
export function formatRunClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const hours = Math.floor(total / MS_PER_HOUR);
  const minutes = Math.floor((total % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((total % MS_PER_MINUTE) / MS_PER_SECOND);
  const millis = total % MS_PER_SECOND;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}:${pad(millis, 3)}`;
}

/** Elapsed time in words for a person, e.g. "1m 17s", "42s", "1h 3m". */
export function formatRunDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / MS_PER_SECOND));
  const hours = Math.floor(total / (MS_PER_HOUR / MS_PER_SECOND));
  const minutes = Math.floor(
    (total % (MS_PER_HOUR / MS_PER_SECOND)) / (MS_PER_MINUTE / MS_PER_SECOND),
  );
  const seconds = total % (MS_PER_MINUTE / MS_PER_SECOND);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * The Run's clock, in a line of text: counts up from 00:00:00:000 while the run works, then
 * holds the run's final time. Only this component re-renders on each frame.
 */
export function RunClock({ startedAt, endedAt }: { startedAt: number; endedAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endedAt != null) return;
    let frame = requestAnimationFrame(function tick() {
      setNow(Date.now());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [endedAt]);

  return (
    <Text type="supporting" weight="semibold" hasTabularNumbers>
      {formatRunClock((endedAt ?? now) - startedAt)}
    </Text>
  );
}
