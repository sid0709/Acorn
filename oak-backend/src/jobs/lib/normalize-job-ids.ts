/** Mongo ObjectId hex used for Job / TempJob ids. */
export const JOB_OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

export function normalizeJobIds(raw: unknown): string[] {
  const requested = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of requested) {
    const id = String(value ?? '').trim();
    if (!JOB_OBJECT_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
