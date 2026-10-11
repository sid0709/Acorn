import {
  supportClaimAttachmentPath,
  type ClaimThreadData,
  type SupportAttachment,
} from "@acorn/support-chat";
import { useCallback, useEffect, useRef, useState } from "react";

import { authHeaders, getAcornApiUrl } from "../auth/acorn-auth";

/** Images fetched for one claim, as object URLs this hook owns. */
type Loaded = { claimId: string; ids: Set<string>; made: string[] };

function release(loaded: Loaded | null) {
  for (const url of loaded?.made ?? []) URL.revokeObjectURL(url);
}

/**
 * Local URLs for the open thread's images. An <img> can't send the session token, so each
 * image is fetched with it once and shown from an object URL. New images load as they
 * arrive; all of them are released when another claim opens or the panel goes away.
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

  useEffect(() => {
    if (loadedRef.current?.claimId !== claimId) {
      release(loadedRef.current);
      loadedRef.current = claimId ? { claimId, ids: new Set(), made: [] } : null;
    }
    const mine = loadedRef.current;
    if (!mine || !wanted) return;
    const missing = wanted.split(",").filter((id) => !mine.ids.has(id));
    if (!missing.length) return;
    for (const id of missing) mine.ids.add(id);
    void (async () => {
      const base = (await getAcornApiUrl()).replace(/\/$/, "");
      const headers = await authHeaders().catch(() => null);
      for (const id of missing) {
        const res = headers
          ? await fetch(`${base}${supportClaimAttachmentPath(claimId, id)}`, { headers }).catch(
              () => null,
            )
          : null;
        const blob = res?.ok ? await res.blob().catch(() => null) : null;
        if (loadedRef.current !== mine) return;
        if (!blob) {
          mine.ids.delete(id);
          continue;
        }
        const url = URL.createObjectURL(blob);
        mine.made.push(url);
        setShown((current) => ({
          claimId,
          urls: { ...(current.claimId === claimId ? current.urls : {}), [id]: url },
        }));
      }
    })();
  }, [claimId, wanted]);

  return useCallback(
    (attachment: SupportAttachment) =>
      shown.claimId === claimId ? shown.urls[attachment.id] : undefined,
    [shown, claimId],
  );
}
