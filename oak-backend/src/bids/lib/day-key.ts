import { asDate } from './iso';

/** YYYY-MM-DD from bidReadyDate / pooledAt (local calendar day of the ISO instant). */
export function dayKeyFromIso(iso: string | Date | null | undefined): string {
  const d = asDate(iso) ?? new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function initials(name: string | null | undefined): string {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}
