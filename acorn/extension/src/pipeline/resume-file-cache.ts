/**
 * Résumé files a run attaches, kept for the length of a run. A run fills one page
 * several times (the page, then each entry form a requirement opens), and loads the
 * file as soon as recommend picks it, before the first fill asks: a load still in
 * flight is shared, never started twice. A file is kept by what names it (its
 * Library id, its generation, its job) and only briefly; behind this, the file
 * cache (api/file-cache.ts) keeps copies on disk and asks the API whether each is
 * still current, so an edited résumé is never attached stale.
 */

import type { RuntimeAttachedFile } from "@acorn/shared/plan-runner/types";

/** How long a fetched résumé is reused: longer than a run takes, short enough to see an edit. */
const RESUME_FILE_REUSE_MS = 10 * 60_000;
/** Files kept at once: one per run, with a few runs going in other tabs. */
const RESUME_FILES_KEPT = 8;

const kept = new Map<string, { at: number; file: Promise<RuntimeAttachedFile | null> }>();

/** The file `key` names: the one fetched lately (or being fetched), else `fetchFile`'s. */
export async function cachedResumeFile(
  key: string,
  fetchFile: () => Promise<RuntimeAttachedFile | null>,
): Promise<RuntimeAttachedFile | null> {
  const now = Date.now();
  for (const [name, entry] of kept) {
    if (now - entry.at > RESUME_FILE_REUSE_MS) kept.delete(name);
  }
  let entry = kept.get(key);
  if (!entry) {
    entry = { at: now, file: fetchFile() };
    kept.set(key, entry);
    for (const name of kept.keys()) {
      if (kept.size <= RESUME_FILES_KEPT) break;
      kept.delete(name);
    }
  }
  const pending = entry;
  try {
    const file = await pending.file;
    // Nothing to keep: the next use asks again.
    if (!file && kept.get(key) === pending) kept.delete(key);
    return file ? { ...file } : null;
  } catch (err) {
    if (kept.get(key) === pending) kept.delete(key);
    throw err;
  }
}
