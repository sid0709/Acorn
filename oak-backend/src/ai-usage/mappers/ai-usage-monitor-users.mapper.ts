import type { AccountInfo } from '@prisma/client';
import { AI_USAGE_KEY_PROVIDERS } from '../constants/ai-usage.constants';
import { fingerprintApiKey, roundCostUsd } from '../lib/mask-api-key';
import {
  emptyUsageBucket,
  type AiUsageBucket,
} from './ai-usage-monitor.mapper';

export type MonitorKeyIndexEntry = {
  provider: string;
  value: string | null;
  fingerprint: string;
  users: string[];
  calls: number;
  costUsd: number;
  totalTokens: number;
};

export type MonitorUserRow = {
  name: string;
  tier: string | null;
  vendorAllowed: boolean;
  fullName: string | null;
  email: string | null;
  defaultProvider: string | null;
  defaultModel: string | null;
  profileUpdatedAt: string | null;
  keys: Array<{
    provider: string;
    configured: boolean;
    value: string | null;
  }>;
  usage: AiUsageBucket;
};

export function buildMonitorUsers(input: {
  accounts: AccountInfo[];
  usageByName: Map<string, AiUsageBucket>;
  decryptProfile: (profile: Record<string, unknown>) => Record<string, unknown>;
}): { users: MonitorUserRow[]; keyIndex: Map<string, MonitorKeyIndexEntry> } {
  const keyIndex = new Map<string, MonitorKeyIndexEntry>();
  const users: MonitorUserRow[] = [];
  for (const acc of input.accounts) {
    const name = String(acc.name || '').trim();
    if (!name) continue;
    const rawProfile =
      acc.autoBidProfile &&
      typeof acc.autoBidProfile === 'object' &&
      !Array.isArray(acc.autoBidProfile)
        ? (acc.autoBidProfile as Record<string, unknown>)
        : {};
    const profile = input.decryptProfile(rawProfile);
    const keys = AI_USAGE_KEY_PROVIDERS.map(({ provider, field }) => {
      const raw = String(profile[field] || '').trim();
      const configured = Boolean(raw);
      return {
        provider,
        configured,
        value: configured ? raw : null,
        fingerprint: configured ? fingerprintApiKey(raw) : null,
      };
    });
    const usage = input.usageByName.get(name) || emptyUsageBucket();
    attributeKeys(keyIndex, name, keys, usage);
    users.push({
      name,
      tier: acc.tier ?? null,
      vendorAllowed: Boolean(acc.vendorAllowed),
      fullName: asNullableStr(profile.fullName),
      email: asNullableStr(profile.email),
      defaultProvider: asNullableStr(profile.defaultProvider),
      defaultModel: asNullableStr(profile.defaultModel),
      profileUpdatedAt: asNullableStr(profile.updatedAt),
      keys: keys.map(({ fingerprint: _fp, ...rest }) => rest),
      usage,
    });
  }
  users.sort(
    (a, b) =>
      (b.usage.costUsd || 0) - (a.usage.costUsd || 0) ||
      a.name.localeCompare(b.name),
  );
  return { users, keyIndex };
}

export function buildUnassigned(
  usageByName: Map<string, AiUsageBucket>,
  knownNames: Set<string>,
): Array<{ name: string; usage: AiUsageBucket }> {
  const rows: { name: string; usage: AiUsageBucket }[] = [];
  for (const [name, usage] of usageByName.entries()) {
    if (!name || knownNames.has(name)) continue;
    rows.push({ name: name || '(no applier)', usage });
  }
  rows.sort((a, b) => (b.usage.costUsd || 0) - (a.usage.costUsd || 0));
  const blank = usageByName.get('');
  if (blank && (blank.calls || 0) > 0) {
    rows.unshift({ name: '(no applier)', usage: blank });
  }
  return rows;
}

function attributeKeys(
  keyIndex: Map<string, MonitorKeyIndexEntry>,
  name: string,
  keys: Array<{
    provider: string;
    configured: boolean;
    value: string | null;
    fingerprint: string | null;
  }>,
  usage: AiUsageBucket,
) {
  for (const key of keys) {
    if (!key.configured || !key.fingerprint) continue;
    const mapKey = `${key.provider}:${key.fingerprint}`;
    let entry = keyIndex.get(mapKey);
    if (!entry) {
      entry = {
        provider: key.provider,
        value: key.value,
        fingerprint: key.fingerprint,
        users: [],
        calls: 0,
        costUsd: 0,
        totalTokens: 0,
      };
      keyIndex.set(mapKey, entry);
    }
    if (!entry.users.includes(name)) entry.users.push(name);
    for (const p of usage.byProvider) {
      if (p.provider === key.provider) {
        entry.calls += p.calls || 0;
        entry.costUsd = roundCostUsd(entry.costUsd + (p.costUsd || 0));
        entry.totalTokens += p.totalTokens || 0;
      }
    }
  }
}

function asNullableStr(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t || null;
}
