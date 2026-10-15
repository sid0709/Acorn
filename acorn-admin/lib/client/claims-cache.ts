"use client";

import { claimThreadKey, isClaimsListKey, parseClaimsListKey } from "../claims";

import { isClaimsLive } from "./claims-link";
import { mutateCache, readCache, revalidateCache, writeCache } from "./query-cache";

import type { ClaimList } from "../api/claims";
import type { ClaimPush, ClaimThreadData, SupportClaim, SupportMessage } from "@acorn/support-chat";

/** Applies an edit to one claim wherever the cache shows it: its thread and every list. */
export function patchCachedClaim(id: string, patch: Partial<SupportClaim>) {
  const thread = readCache<ClaimThreadData>(claimThreadKey(id));
  if (thread) writeCache(claimThreadKey(id), { ...thread, claim: { ...thread.claim, ...patch } });
  mutateCache<ClaimList>(isClaimsListKey, (list) => ({
    ...list,
    claims: list.claims.map((claim) => (claim.id === id ? { ...claim, ...patch } : claim)),
  }));
}

/** Adds a sent message to the open conversation at once. */
export function appendCachedMessage(id: string, message: SupportMessage) {
  const key = claimThreadKey(id);
  const thread = readCache<ClaimThreadData>(key);
  if (!thread || thread.messages.some((m) => m.id === message.id)) return;
  writeCache(key, { ...thread, messages: [...thread.messages, message] });
}

/** Asks the server again for one claim's thread and every list, after a change. */
export function revalidateClaim(id: string) {
  // While the live stream is up, the change comes back on it and lands in the cache by itself.
  if (isClaimsLive()) return;
  revalidateCache((key) => key === claimThreadKey(id) || isClaimsListKey(key));
}

const newestFirst = (a: SupportClaim, b: SupportClaim) =>
  Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt);

/**
 * One list after a claim changed: the claim sits where its status and recency put it (or
 * leaves, if the filter no longer shows it), and the counts are the server's. A search list
 * keeps a claim it already shows and takes no others: it cannot tell what the search matches.
 */
export function placeClaim(
  list: ClaimList,
  key: string,
  claim: SupportClaim,
  counts: Pick<ClaimPush, "open" | "awaitingSupport">,
): ClaimList {
  const { filter, query } = parseClaimsListKey(key);
  const isShown = list.claims.some((row) => row.id === claim.id);
  const belongs = (filter === "all" || filter === claim.status) && (!query || isShown);
  const others = list.claims.filter((row) => row.id !== claim.id);
  const merged = isShown ? { ...list.claims.find((row) => row.id === claim.id), ...claim } : claim;
  return {
    claims: belongs ? [...others, merged].sort(newestFirst) : others,
    open: counts.open ?? list.open,
    awaitingSupport: counts.awaitingSupport ?? list.awaitingSupport,
  };
}

/**
 * Applies a change the server pushed: the message joins its conversation, the claim moves in
 * every list, and the counts update. Nothing is asked of the server again unless the push could
 * not say enough (it has no counts, or a new claim might match a search).
 */
export function applyClaimChange(push: ClaimPush) {
  const { claim, message, open, awaitingSupport } = push;
  if (!claim?.id) return;
  if (message) appendCachedMessage(claim.id, message);
  patchCachedClaim(claim.id, claim);
  mutateCache<ClaimList>(isClaimsListKey, (list, key) =>
    placeClaim(list, key, claim, { open, awaitingSupport }),
  );
  const hasCounts = open !== undefined && awaitingSupport !== undefined;
  const isNew = message === undefined;
  if (!hasCounts) revalidateCache(isClaimsListKey);
  else if (isNew)
    revalidateCache((key) => isClaimsListKey(key) && parseClaimsListKey(key).query !== "");
}
