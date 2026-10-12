/**
 * The newest Acorn extension, as the site knows it. Every deploy packs the
 * extension and records its version on the site (tools/extension-release.mjs), so
 * the site always names the latest build and where to download it.
 */

/** The site's route that names the newest extension build. */
export const EXTENSION_LATEST_PATH = "/api/extension/latest";

export interface ExtensionRelease {
  /** The newest packed version; null when the site was built without one. */
  version: string | null;
  /** The packed build to download (a path on the site, or a full URL); null when there is none. */
  downloadUrl: string | null;
  /** The store listing, when there is one. */
  installUrl: string | null;
}

/** A version's numeric parts ("1.41.0" → [1, 41, 0]); a part that is not a number counts as 0. */
function versionParts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** Whether `current` is older than `latest` (both semver like 1.41.0). */
export function isOlderVersion(current: string, latest: string): boolean {
  const a = versionParts(current);
  const b = versionParts(latest);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
}
