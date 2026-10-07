import { CLAIM_STATUS, type ClaimStatus } from "@acorn/support-chat";

/** The inbox's status filter; "all" shows both. */
export const CLAIM_FILTERS = [
  { value: CLAIM_STATUS.open, label: "Opened" },
  { value: CLAIM_STATUS.closed, label: "Closed" },
  { value: "all", label: "All" },
] as const;
export type ClaimFilter = (typeof CLAIM_FILTERS)[number]["value"];
export const DEFAULT_CLAIM_FILTER: ClaimFilter = CLAIM_STATUS.open;

export function claimFilterFrom(raw: string | undefined): ClaimFilter {
  return CLAIM_FILTERS.some((f) => f.value === raw) ? (raw as ClaimFilter) : DEFAULT_CLAIM_FILTER;
}

/** The status acorn-backend filters by, or "" for every claim. */
export function statusFor(filter: ClaimFilter): ClaimStatus | "" {
  return filter === "all" ? "" : filter;
}
