import { adminJSON, query } from "./client";

import type { ClaimStatus, ClaimThreadData, SupportClaim } from "@acorn/support-chat";

const CLAIMS_PATH = "/acorn/admin/claims";
export const claimPath = (id: string) => `${CLAIMS_PATH}/${encodeURIComponent(id)}`;

export type ClaimList = { claims: SupportClaim[]; open: number; awaitingSupport: number };

export async function listClaims(status: ClaimStatus | "", q: string): Promise<ClaimList> {
  const body = await adminJSON<ClaimList>(`${CLAIMS_PATH}${query({ status, q })}`);
  return body ?? { claims: [], open: 0, awaitingSupport: 0 };
}

export function getClaimThread(id: string) {
  return adminJSON<ClaimThreadData>(claimPath(id));
}
