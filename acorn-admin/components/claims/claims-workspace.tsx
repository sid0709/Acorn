"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { ClaimListPanel } from "./claim-list-panel";
import { ClaimsInbox } from "./claims-inbox";

import type { ClaimList } from "@/lib/api/claims";
import type { ClaimThreadData } from "@acorn/support-chat";

import { CLAIM_FILTERS, claimFilterFrom, claimThreadKey, claimsListKey } from "@/lib/claims";
import { useClaimsLive } from "@/lib/client/claims-live";
import { prefetchCache, useCachedQuery } from "@/lib/client/query-cache";
import { CLAIMS_POLL_MS } from "@/lib/config";
import { ROUTES } from "@/lib/routes";

/** How many of the newest claims have their conversation loaded ahead of a click. */
const PREFETCH_THREADS = 6;

/** The open claim's id from the address, or null on the bare list. */
function claimIdFrom(pathname: string): string | null {
  const prefix = `${ROUTES.claims}/`;
  return pathname.startsWith(prefix) ? decodeURIComponent(pathname.slice(prefix.length)) : null;
}

/**
 * Support's claims workspace. The address says which claim and filter are showing; everything
 * else comes from the client cache, so moving between claims and filters never waits on the
 * server: lists and the newest conversations are loaded ahead, and the rest as the pointer arrives.
 * New messages and claims are pushed into that cache as they happen (useClaimsLive).
 */
export function ClaimsWorkspace() {
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = claimIdFrom(pathname);
  const filter = claimFilterFrom(params.get("status") ?? undefined);
  const query = params.get("q")?.trim() ?? "";

  // Changes arrive on the live stream; polling is the fallback while it is down.
  const pollMs = useClaimsLive() ? undefined : CLAIMS_POLL_MS;
  const { data: list } = useCachedQuery<ClaimList>(claimsListKey(filter, query), pollMs);
  const { data: thread, error: threadError } = useCachedQuery<ClaimThreadData>(
    selectedId ? claimThreadKey(selectedId) : null,
    pollMs,
  );

  useEffect(() => {
    for (const item of CLAIM_FILTERS) prefetchCache(claimsListKey(item.value, ""));
  }, []);

  const newest = list?.claims
    .slice(0, PREFETCH_THREADS)
    .map((claim) => claim.id)
    .join(",");
  useEffect(() => {
    if (newest) for (const id of newest.split(",")) prefetchCache(claimThreadKey(id));
  }, [newest]);

  return (
    <div className="claims-inbox">
      <ClaimsInbox
        selectedId={selectedId}
        thread={thread ?? null}
        isThreadLoading={selectedId !== null && !thread && !threadError}
        threadError={thread ? undefined : threadError}
        summary={list?.claims.find((claim) => claim.id === selectedId)}
        list={
          <ClaimListPanel
            claims={list?.claims}
            filter={filter}
            query={query}
            awaitingSupport={list?.awaitingSupport ?? 0}
            selectedId={selectedId}
          />
        }
      />
    </div>
  );
}
