import { authHeaders, getAcornApiUrl } from "../../auth/acorn-auth";

import { extractError } from "./http";

/**
 * The profile's default account password, as the backend fills it into a site's
 * account forms. Read from the signed-in Acorn profile; shown in the sidebar only.
 */
export async function fetchDefaultAccountPassword(): Promise<string> {
  const base = (await getAcornApiUrl()).replace(/\/$/, "");
  const res = await fetch(`${base}/acorn/profile`, { headers: await authHeaders() });
  const data = (await res.json().catch(() => ({}))) as {
    profile?: { defaultAccountPassword?: string };
    error?: string;
    message?: string;
  };
  if (!res.ok) throw new Error(extractError(data, `Profile failed: ${res.status}`));
  return data.profile?.defaultAccountPassword ?? "";
}
