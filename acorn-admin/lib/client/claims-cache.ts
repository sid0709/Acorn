"use client";

import { claimThreadKey, isClaimsListKey } from "../claims";

import { mutateCache, readCache, revalidateCache, writeCache } from "./query-cache";

import type { ClaimList } from "../api/claims";
import type { ClaimThreadData, SupportClaim, SupportMessage } from "@acorn/support-chat";

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
  revalidateCache((key) => key === claimThreadKey(id) || isClaimsListKey(key));
}
