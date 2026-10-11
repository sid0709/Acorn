import { listClaims } from "@/lib/api/claims";
import { jsonRoute } from "@/lib/api/route";
import { claimFilterFrom, statusFor } from "@/lib/claims";

/** The claim list and counts for a status filter and search, for the client cache. */
export const GET = jsonRoute(async (request) => {
  const params = new URL(request.url).searchParams;
  const filter = claimFilterFrom(params.get("status") ?? "all");
  return listClaims(statusFor(filter), params.get("q")?.trim() ?? "");
});
