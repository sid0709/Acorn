/**
 * Résumé files a fill attached, kept for the length of a run. A run fills one page
 * several times (the page, then each entry form a requirement opens), and fetching
 * the same file again for each costs seconds. A file is kept by what names it (its
 * Library id, its generation, its job) and only briefly, so a résumé changed since
 * is fetched anew.
 */

import type { RuntimeAttachedFile } from "@acorn/shared/plan-runner/types";

/** How long a fetched résumé is reused: longer than a run takes, short enough to see an edit. */
const RESUME_FILE_REUSE_MS = 10 * 60_000;
/** Files kept at once: one per run, with a few runs going in other tabs. */
const RESUME_FILES_KEPT = 8;

const kept = new Map<string, { at: number; file: RuntimeAttachedFile }>();

/** The file `key` names: the one fetched lately, else `fetchFile`'s, kept when there is one. */
export async function cachedResumeFile(
  key: string,
  fetchFile: () => Promise<RuntimeAttachedFile | null>,
): Promise<RuntimeAttachedFile | null> {
  const now = Date.now();
  for (const [name, entry] of kept) {
    if (now - entry.at > RESUME_FILE_REUSE_MS) kept.delete(name);
  }
  const hit = kept.get(key);
  if (hit) return { ...hit.file };
  const file = await fetchFile();
  if (!file) return null;
  kept.set(key, { at: now, file });
  for (const name of kept.keys()) {
    if (kept.size <= RESUME_FILES_KEPT) break;
    kept.delete(name);
  }
  return { ...file };
}
