import { getClaimThread } from "@/lib/api/claims";
import { jsonRoute } from "@/lib/api/route";

/** One claim with its messages, for the client cache. */
export const GET = jsonRoute(async (_request, { params }: { params: Promise<{ id: string }> }) => {
  return getClaimThread((await params).id);
});
