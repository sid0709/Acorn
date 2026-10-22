/** Normalize companyName → stable companyKey (trim, lowercase, collapse whitespace). */
export function normalizeCompanyKey(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
