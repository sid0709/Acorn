import { CLAIM_STATUS, CLAIM_STATUS_LABEL, type ClaimStatus } from "@acorn/support-chat";

/** The inbox's status filter; "all" shows both. */
export const CLAIM_FILTERS = [
  { value: CLAIM_STATUS.open, label: CLAIM_STATUS_LABEL.open },
  { value: CLAIM_STATUS.closed, label: CLAIM_STATUS_LABEL.closed },
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

/** The console's own JSON routes for claims, which the client cache reads. */
export const CLAIMS_API = "/api/claims";
export const claimsListKey = (filter: ClaimFilter, q: string) => {
  const search = new URLSearchParams();
  const status = statusFor(filter);
  if (status) search.set("status", status);
  if (q.trim()) search.set("q", q.trim());
  const text = search.toString();
  return text ? `${CLAIMS_API}?${text}` : CLAIMS_API;
};
export const claimThreadKey = (id: string) => `${CLAIMS_API}/${encodeURIComponent(id)}`;
export const isClaimsListKey = (key: string) =>
  key === CLAIMS_API || key.startsWith(`${CLAIMS_API}?`);

/** What a list key asks for: its status filter ("all" when none) and search text. */
export function parseClaimsListKey(key: string): { filter: ClaimFilter; query: string } {
  const params = new URLSearchParams(key.split("?")[1] ?? "");
  const status = params.get("status");
  const filter = CLAIM_FILTERS.find((item) => item.value === status)?.value ?? "all";
  return { filter, query: params.get("q") ?? "" };
}
