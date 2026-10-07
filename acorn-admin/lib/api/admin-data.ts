import { adminFetch, readApiError } from "./client";

export type ClaimRow = {
  id: string;
  accountId: string;
  userEmail: string;
  userName: string;
  pageUrl: string;
  pageTitle: string;
  extensionVersion: string;
  tabKey: string;
  status: string;
  screenshotMime: string;
  createdAt: string;
};

export type ClaimDetail = ClaimRow & {
  screenshotBase64?: string;
};

export type UserRow = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

export type UsageSummary = {
  callCount: number;
  totalCostNanos: number;
  totalTokens: number;
  totalPrice: string;
  lastCallAt: string | null;
};

export type UsageEntry = {
  id: string;
  model: string;
  tabKey: string;
  totalTokens: number;
  durationMs: number;
  price: string;
  priced: boolean;
  costNanos: number;
  createdAt: string;
};

export async function listClaims(): Promise<ClaimRow[]> {
  const res = await adminFetch("/acorn/admin/claims");
  if (!res.ok) throw new Error(await readApiError(res));
  const data = (await res.json()) as { claims?: ClaimRow[] };
  return data.claims ?? [];
}

export async function getClaim(id: string): Promise<ClaimDetail | null> {
  const res = await adminFetch(`/acorn/admin/claims/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await readApiError(res));
  const data = (await res.json()) as { claim?: ClaimDetail };
  return data.claim ?? null;
}

export async function patchClaimStatus(id: string, status: string): Promise<void> {
  const res = await adminFetch(`/acorn/admin/claims/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(await readApiError(res));
}

export async function listUsers(): Promise<UserRow[]> {
  const res = await adminFetch("/acorn/admin/users");
  if (!res.ok) throw new Error(await readApiError(res));
  const data = (await res.json()) as { users?: UserRow[] };
  return data.users ?? [];
}

export async function getUser(id: string): Promise<{ user: UserRow; usage: UsageSummary } | null> {
  const res = await adminFetch(`/acorn/admin/users/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await readApiError(res));
  const data = (await res.json()) as { user?: UserRow; usage?: UsageSummary };
  if (!data.user || !data.usage) return null;
  return { user: data.user, usage: data.usage };
}

export async function listUserUsage(id: string): Promise<UsageEntry[]> {
  const res = await adminFetch(`/acorn/admin/users/${encodeURIComponent(id)}/usage`);
  if (!res.ok) throw new Error(await readApiError(res));
  const data = (await res.json()) as { entries?: UsageEntry[] };
  return data.entries ?? [];
}
