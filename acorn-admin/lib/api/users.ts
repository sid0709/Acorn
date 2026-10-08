import { adminJSON, query } from "./client";
import { assertCurrentStatistics, statsQuery } from "./statistics";

import type { Statistics, StatsFilter } from "../statistics/types";

const USERS_PATH = "/acorn/admin/users";
const userPath = (id: string) => `${USERS_PATH}/${encodeURIComponent(id)}`;

export type AccountUsage = {
  calls: number;
  ok: number;
  cancelled: number;
  successRate: number;
  costNanos: number;
  totalTokens: number;
  lastCallAt: string | null;
};

export type AccountIdentity = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  /** Set when the user deleted the account. The row stays. */
  deactivatedAt?: string | null;
};

export type UserRow = AccountIdentity & {
  usage: AccountUsage;
};

export type Page<T> = { total: number; page: number; pageSize: number } & T;

export type UsageEntry = {
  id: string;
  model: string;
  feature: string;
  step: string;
  route: string;
  status: "ok" | "error" | "cancelled";
  errorKind: string;
  error: string;
  tabKey: string;
  client: string;
  clientVersion: string;
  supportBy: string;
  httpStatus: number;
  finishReason: string;
  attempts: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costNanos: number;
  priced: boolean;
  durationMs: number;
  createdAt: string;
};

export type AuditEntry = {
  id: string;
  admin: string;
  action: string;
  userId: string;
  reason: string;
  at: string;
};

export type UserDetail = {
  user: AccountIdentity;
  statistics: Statistics;
};

const NO_USAGE: AccountUsage = {
  calls: 0,
  ok: 0,
  cancelled: 0,
  successRate: 0,
  costNanos: 0,
  totalTokens: 0,
  lastCallAt: null,
};

export async function listUsers(q: string, page: number) {
  const body = await adminJSON<Page<{ users: UserRow[] }>>(`${USERS_PATH}${query({ q, page })}`);
  if (!body) return { users: [], total: 0, page: 1, pageSize: 0 };
  // An acorn-backend older than this console sends users without usage.
  const users = (body.users ?? []).map((u) => ({ ...u, usage: u.usage ?? NO_USAGE }));
  return { ...body, users, total: body.total ?? users.length, page: body.page ?? 1 };
}

export async function getUser(id: string, filter: StatsFilter): Promise<UserDetail | null> {
  const body = await adminJSON<UserDetail>(`${userPath(id)}${statsQuery(filter)}`);
  if (body) assertCurrentStatistics(body.statistics);
  return body;
}

export async function listUserUsage(id: string, page: number) {
  const body = await adminJSON<Page<{ entries: UsageEntry[] }>>(
    `${userPath(id)}/usage${query({ page })}`,
  );
  return body ?? { entries: [], total: 0, page: 1, pageSize: 0 };
}

/** The support-session trail; empty when support sign-in is not configured. */
export async function listUserAudit(id: string): Promise<AuditEntry[]> {
  try {
    const body = await adminJSON<{ entries: AuditEntry[] }>(`${userPath(id)}/audit`);
    return body?.entries ?? [];
  } catch {
    return [];
  }
}

export const supportSessionPath = (id: string) => `${userPath(id)}/support-session`;
export const supportSessionsPath = (id: string) => `${userPath(id)}/support-sessions`;
