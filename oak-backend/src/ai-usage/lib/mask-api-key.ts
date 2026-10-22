import { createHash } from 'node:crypto';

/** Mask a decrypted API key for display — never return the full secret. */
export function maskApiKey(raw: unknown): string | null {
  const key = String(raw || '').trim();
  if (!key) return null;
  if (key.length <= 8) return '••••••••';
  const dash = key.indexOf('-');
  const prefixLen = Math.min(7, Math.max(3, dash + 1 || 3));
  return `${key.slice(0, prefixLen)}…${key.slice(-4)}`;
}

export function fingerprintApiKey(raw: unknown): string | null {
  const key = String(raw || '').trim();
  if (!key) return null;
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function roundCostUsd(n: unknown): number {
  return Math.round((Number(n) || 0) * 1_000_000) / 1_000_000;
}
