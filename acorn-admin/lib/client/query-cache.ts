"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { ROUTES } from "../routes";

/**
 * A small stale-while-revalidate cache for the console's JSON routes. A read answers from
 * memory at once, then refreshes in the background; a prefetch warms a key before it is
 * needed, so opening a claim or a tab is already loaded when the click lands.
 */

/** What a key holds. Replaced (never edited) on every change, so React sees the change. */
export type CacheState<T> = { data?: T; error?: string };

type Entry = {
  state: CacheState<unknown>;
  at: number;
  inflight?: Promise<unknown>;
  listeners: Set<() => void>;
};

/** Data younger than this is served without asking the network again. */
const FRESH_MS = 4_000;
const EMPTY: CacheState<never> = {};

const entries = new Map<string, Entry>();

function entryFor(key: string): Entry {
  let entry = entries.get(key);
  if (!entry) {
    entry = { state: EMPTY, at: 0, listeners: new Set() };
    entries.set(key, entry);
  }
  return entry;
}

function settle(entry: Entry, state: CacheState<unknown>) {
  entry.state = state;
  if (state.data !== undefined && !state.error) entry.at = Date.now();
  entry.listeners.forEach((listener) => listener());
}

export function readCache<T>(key: string): T | undefined {
  return entries.get(key)?.state.data as T | undefined;
}

/** Replaces what a key holds, for an optimistic edit or a known result. */
export function writeCache<T>(key: string, data: T) {
  settle(entryFor(key), { data });
}

/** Edits every cached value whose key `matches`. */
export function mutateCache<T>(
  matches: (key: string) => boolean,
  edit: (data: T, key: string) => T,
) {
  for (const [key, entry] of entries) {
    if (!matches(key) || entry.state.data === undefined) continue;
    settle(entry, { data: edit(entry.state.data as T, key) });
  }
}

async function fetchJSON<T>(key: string): Promise<T> {
  const res = await fetch(key, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (res.redirected || res.status === 401) {
    window.location.assign(ROUTES.login);
    throw new Error("Signed out");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Loads a key, sharing one request between callers. `force` ignores fresh data. */
export function loadCache<T>(key: string, force = false): Promise<T> {
  const entry = entryFor(key);
  if (entry.inflight) return entry.inflight as Promise<T>;
  if (!force && entry.state.data !== undefined && Date.now() - entry.at < FRESH_MS) {
    return Promise.resolve(entry.state.data as T);
  }
  const request = fetchJSON<T>(key)
    .then((data) => {
      settle(entry, { data });
      return data;
    })
    .catch((err: unknown) => {
      // Keep what was showing; a failed refresh only matters when there is nothing yet.
      settle(entry, {
        data: entry.state.data,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    })
    .finally(() => {
      entry.inflight = undefined;
    });
  entry.inflight = request;
  return request;
}

/** Warms a key and swallows failures: a prefetch that misses costs nothing. */
export function prefetchCache(key: string) {
  void loadCache(key).catch(() => undefined);
}

/** Refetches every key that `matches` and already holds data. */
export function revalidateCache(matches: (key: string) => boolean) {
  for (const [key, entry] of entries) {
    if (matches(key) && entry.state.data !== undefined) {
      void loadCache(key, true).catch(() => undefined);
    }
  }
}

/**
 * What `key` holds, refreshed on mount and every `pollMs` while the tab is visible.
 * `data` is undefined until the first answer; a null key reads nothing.
 */
export function useCachedQuery<T>(key: string | null, pollMs?: number): CacheState<T> {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!key) return () => undefined;
      const entry = entryFor(key);
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    [key],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => (key ? (entries.get(key)?.state ?? EMPTY) : EMPTY),
    () => EMPTY,
  ) as CacheState<T>;

  useEffect(() => {
    if (!key) return;
    prefetchCache(key);
    if (!pollMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadCache(key, true).catch(() => undefined);
    }, pollMs);
    return () => clearInterval(timer);
  }, [key, pollMs]);

  return state;
}
