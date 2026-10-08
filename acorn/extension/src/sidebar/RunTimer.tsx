import { useEffect, useState } from "react";
import { HStack, Text } from "sid-ui";

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

/**
 * The Run's clock: counts up from 00:00:00:000 while the run works, then holds the
 * run's final time. Only this component re-renders on each frame.
 */
export function RunTimer({ startedAt, endedAt }: { startedAt: number; endedAt?: number }) {
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
    <HStack gap={2} align="center" justify="between">
      <Text type="supporting">{endedAt != null ? "Run time" : "Running for"}</Text>
      <Text type="large" weight="semibold" hasTabularNumbers>
        {formatRunClock((endedAt ?? now) - startedAt)}
      </Text>
    </HStack>
  );
}
