import {
  ATTACHMENT_SIZE,
  type AttachmentSize,
  type ClaimThreadData,
  type SupportAttachment,
} from "@acorn/support-chat";
import { useCallback, useEffect, useRef, useState } from "react";

import { imageKey, loadClaimImage } from "./claim-image-cache";

/** Images requested for one claim, and the object URLs made for them. */
type Loaded = { claimId: string; requested: Set<string>; made: string[] };

function release(loaded: Loaded | null) {
  for (const url of loaded?.made ?? []) URL.revokeObjectURL(url);
}

/**
 * Local URLs for the open thread's images. An <img> can't send the session token, so each
 * image is fetched with it and shown from an object URL (see claim-image-cache).
 *
 * The thread shows thumbnails: small previews, newest message first, several at a time. An
 * original loads only when `loadFull` asks for it, as a thumbnail is opened. Every URL is
 * released when another claim opens or the panel goes away; the bytes stay in the cache.
 */
export function useClaimAttachments(thread: ClaimThreadData | null) {
  const [shown, setShown] = useState<{ claimId: string; urls: Record<string, string> }>({
    claimId: "",
    urls: {},
  });
  const loadedRef = useRef<Loaded | null>(null);
  const claimId = thread?.claim.id ?? "";
  const wanted = (thread?.messages ?? [])
    .flatMap((message) => message.attachments ?? [])
    .map((attachment) => attachment.id)
    .join(",");

  useEffect(() => {
    const holder = loadedRef;
    return () => release(holder.current);
  }, []);

  const request = useCallback((ids: string[], size: AttachmentSize) => {
    const mine = loadedRef.current;
    if (!mine) return;
    for (const id of ids) {
      const key = imageKey(size, id);
      if (mine.requested.has(key)) continue;
      mine.requested.add(key);
      void (async () => {
        const blob = await loadClaimImage(mine.claimId, id, size);
        if (loadedRef.current !== mine) return;
        if (!blob) {
          mine.requested.delete(key);
          return;
        }
        const url = URL.createObjectURL(blob);
        mine.made.push(url);
        setShown((current) => ({
          claimId: mine.claimId,
          urls: { ...(current.claimId === mine.claimId ? current.urls : {}), [key]: url },
        }));
      })();
    }
  }, []);

  useEffect(() => {
    if (loadedRef.current?.claimId !== claimId) {
      release(loadedRef.current);
      loadedRef.current = claimId ? { claimId, requested: new Set(), made: [] } : null;
    }
    if (wanted) request(wanted.split(",").reverse(), ATTACHMENT_SIZE.thumb);
  }, [claimId, wanted, request]);

  const src = useCallback(
    (attachment: SupportAttachment, size: AttachmentSize) =>
      shown.claimId === claimId ? shown.urls[imageKey(size, attachment.id)] : undefined,
    [shown, claimId],
  );
  const loadFull = useCallback(
    (attachments: SupportAttachment[]) =>
      request(
        attachments.map((attachment) => attachment.id),
        ATTACHMENT_SIZE.full,
      ),
    [request],
  );

  return { src, loadFull };
}
