"use client";

import { useSyncExternalStore } from "react";
import { dayKey, type Day } from "@/lib/workspace/dates";

const subscribe = () => () => {};

/**
 * Today on this browser's clock. The server renders the page with its own today, so the first
 * render agrees with it; once the page is live it moves to the person's. A day starts when the
 * person's does, not the server's.
 */
export function useToday(serverToday: Day): Day {
  return useSyncExternalStore(
    subscribe,
    () => dayKey(new Date()),
    () => serverToday,
  );
}
