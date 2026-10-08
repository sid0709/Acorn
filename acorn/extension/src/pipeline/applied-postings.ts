/**
 * Postings a run finished applying to, so a later run on the same posting stops
 * instead of applying twice. A posting is its page address without query or
 * fragment (the same page whatever tracking it was opened with). Kept per browser.
 */

/** chrome.storage.local key of the postings a run applied to. */
export const APPLIED_POSTINGS_STORAGE_KEY = "acornAppliedPostings";

export interface AppliedPosting {
  /** When the run finished (ms since epoch). */
  at: number;
  title: string;
}

type AppliedMap = Record<string, AppliedPosting>;

/** The posting's address without query, fragment, or a trailing slash. */
export function postingKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return "";
  }
}

async function readApplied(): Promise<AppliedMap> {
  const stored = await chrome.storage.local.get([APPLIED_POSTINGS_STORAGE_KEY]);
  const map = stored[APPLIED_POSTINGS_STORAGE_KEY] as AppliedMap | undefined;
  return map && typeof map === "object" ? map : {};
}

/** The record of an earlier finished application to this posting, if any. */
export async function appliedTo(url: string): Promise<AppliedPosting | null> {
  const key = postingKey(url);
  if (!key) return null;
  return (await readApplied())[key] ?? null;
}

/** Remember the postings a finished run applied to. */
export async function rememberApplied(urls: string[], title: string): Promise<void> {
  const map = await readApplied();
  for (const url of urls) {
    const key = postingKey(url);
    if (key) map[key] = { at: Date.now(), title };
  }
  await chrome.storage.local.set({ [APPLIED_POSTINGS_STORAGE_KEY]: map });
}
