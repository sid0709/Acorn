/** NFKD slug for Firebase folder segment (profile name). Max 80 chars. */
export function storageSlug(raw: string): string {
  const base = String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'profile';
}

/** Bid-recording folder under `bid-recordings/`. Max 64 chars. */
export function bidStorageSlug(raw: string): string {
  return (
    String(raw || 'unknown')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'unknown'
  );
}
