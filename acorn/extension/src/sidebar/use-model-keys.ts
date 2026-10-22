import { ACORN_PROFILE_KEYS_API, type ModelKeysStatus } from "@acorn/shared/model-keys";
import { useEffect, useState } from "react";

import { authHeaders, getAcornApiUrl } from "../auth/acorn-auth";

/** How often the keys' state is read again while the sidebar is open (the server keeps each answer 10 min). */
export const MODEL_KEYS_REFRESH_MS = 5 * 60_000;

async function readModelKeys(): Promise<ModelKeysStatus | null> {
  const base = (await getAcornApiUrl()).replace(/\/$/, "");
  const res = await fetch(`${base}${ACORN_PROFILE_KEYS_API}`, { headers: await authHeaders() });
  if (!res.ok) return null;
  const body = (await res.json()) as Partial<ModelKeysStatus>;
  return body.openrouter && body.openai
    ? { openrouter: body.openrouter, openai: body.openai }
    : null;
}

/**
 * Whether each model key of the signed-in profile is set and works: read when the sidebar opens, every few
 * minutes, and when the panel is shown again (the person may have just saved a key on the website). Null
 * until the first answer, or when it cannot be read.
 */
export function useModelKeys(signedIn: boolean): ModelKeysStatus | null {
  const [status, setStatus] = useState<ModelKeysStatus | null>(null);
  useEffect(() => {
    if (!signedIn) {
      setStatus(null);
      return;
    }
    let live = true;
    const read = () => {
      void readModelKeys()
        .then((next) => {
          if (live) setStatus(next);
        })
        .catch(() => undefined);
    };
    read();
    const timer = window.setInterval(read, MODEL_KEYS_REFRESH_MS);
    const onShow = () => {
      if (document.visibilityState === "visible") read();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [signedIn]);
  return status;
}
