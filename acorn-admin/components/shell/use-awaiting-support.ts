"use client";

import type { ClaimList } from "@/lib/api/claims";

import { DEFAULT_CLAIM_FILTER, claimsListKey } from "@/lib/claims";
import { useCachedQuery } from "@/lib/client/query-cache";
import { NAV_COUNT_POLL_MS } from "@/lib/config";

/**
 * How many claims wait on support, for the nav badge. It reads the inbox's default list, so
 * the badge also warms the Claims page: opening it shows the list without waiting.
 */
export function useAwaitingSupport(): number {
  const { data } = useCachedQuery<ClaimList>(
    claimsListKey(DEFAULT_CLAIM_FILTER, ""),
    NAV_COUNT_POLL_MS,
  );
  return data?.awaitingSupport ?? 0;
}
