import { notFound } from "next/navigation";

import { ClaimListPanel } from "./claim-list-panel";
import { ClaimsInbox } from "./claims-inbox";

import { getClaimThread, listClaims } from "@/lib/api/claims";
import { claimFilterFrom, statusFor } from "@/lib/claims";

/** Loads the claim list for the URL's filter, and the open claim's thread when one is chosen. */
export async function ClaimsWorkspace({
  selectedId,
  searchParams,
}: {
  selectedId: string | null;
  searchParams: { status?: string; q?: string };
}) {
  const filter = claimFilterFrom(searchParams.status);
  const query = searchParams.q?.trim() ?? "";
  const [list, thread] = await Promise.all([
    listClaims(statusFor(filter), query),
    selectedId ? getClaimThread(selectedId) : Promise.resolve(null),
  ]);
  if (selectedId && !thread) notFound();
  return (
    <div className="claims-inbox">
      <ClaimsInbox
        thread={thread}
        list={
          <ClaimListPanel
            claims={list.claims}
            filter={filter}
            query={query}
            awaitingSupport={list.awaitingSupport}
            selectedId={selectedId}
          />
        }
      />
    </div>
  );
}
