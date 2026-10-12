import {
  EXTENSION_LATEST_PATH,
  isOlderVersion,
  type ExtensionRelease,
} from "@acorn/shared/extension-release";

import { DEFAULT_ACORN_WEB_URL } from "../auth/acorn-auth";

/** The site is asked once per sidebar load; a slow answer is dropped, never awaited by anything. */
const LATEST_RELEASE_TIMEOUT_MS = 8_000;

/** A newer build than this one, and where to get it. */
export interface AvailableUpdate {
  current: string;
  latest: string;
  /** The packed build (or the store listing) to open. */
  href: string;
}

/** This build's version, from acorn/extension/package.json. */
export const CURRENT_VERSION = import.meta.env.VITE_ACORN_VERSION ?? "";

/**
 * Asks the site which extension it was last deployed with. Null when this build
 * is the latest, the site names no download, or it cannot be reached.
 */
export async function findAvailableUpdate(): Promise<AvailableUpdate | null> {
  const base = DEFAULT_ACORN_WEB_URL.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}${EXTENSION_LATEST_PATH}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(LATEST_RELEASE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const release = (await res.json()) as ExtensionRelease;
    const link = release.downloadUrl ?? release.installUrl;
    if (!release.version || !link || !CURRENT_VERSION) return null;
    if (!isOlderVersion(CURRENT_VERSION, release.version)) return null;
    return {
      current: CURRENT_VERSION,
      latest: release.version,
      href: new URL(link, base).toString(),
    };
  } catch {
    return null;
  }
}
