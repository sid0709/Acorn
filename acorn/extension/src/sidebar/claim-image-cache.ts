import { supportClaimAttachmentPath, type AttachmentSize } from "@acorn/support-chat";

import { authHeaders, getAcornApiUrl } from "../auth/acorn-auth";

/**
 * Images of support conversations, kept as blobs for as long as the extension runs. An image
 * never changes once sent, so a conversation reopened later shows at once instead of fetching
 * again. The oldest go first once the bytes reach MAX_CACHED_BYTES; thumbnails are tens of KB,
 * so the budget holds hundreds of them and a few originals.
 */
const MAX_CACHED_BYTES = 32 << 20;
/** How many images load at once: enough to fill a thread fast, few enough not to starve the socket. */
const FETCH_CONCURRENCY = 4;

const blobs = new Map<string, Blob>();
let cachedBytes = 0;

export const imageKey = (size: AttachmentSize, attachmentId: string) => `${size}:${attachmentId}`;

export function cachedImage(key: string): Blob | undefined {
  const blob = blobs.get(key);
  if (blob) {
    // Most recently used goes last.
    blobs.delete(key);
    blobs.set(key, blob);
  }
  return blob;
}

function remember(key: string, blob: Blob) {
  if (blobs.has(key)) cachedBytes -= blobs.get(key)?.size ?? 0;
  blobs.set(key, blob);
  cachedBytes += blob.size;
  for (const [oldKey, old] of blobs) {
    if (cachedBytes <= MAX_CACHED_BYTES || oldKey === key) break;
    blobs.delete(oldKey);
    cachedBytes -= old.size;
  }
}

let running = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= FETCH_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await task();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/**
 * One image of a claim: from the cache, else fetched with the session token (an <img> can't
 * send it). Null when it could not be had. Fetches run FETCH_CONCURRENCY at a time.
 */
export async function loadClaimImage(
  claimId: string,
  attachmentId: string,
  size: AttachmentSize,
): Promise<Blob | null> {
  const key = imageKey(size, attachmentId);
  const hit = cachedImage(key);
  if (hit) return hit;
  return withSlot(async () => {
    const base = (await getAcornApiUrl()).replace(/\/$/, "");
    const headers = await authHeaders().catch(() => null);
    if (!headers) return null;
    const res = await fetch(`${base}${supportClaimAttachmentPath(claimId, attachmentId, size)}`, {
      headers,
    }).catch(() => null);
    const blob = res?.ok ? await res.blob().catch(() => null) : null;
    if (blob) remember(key, blob);
    return blob;
  });
}
