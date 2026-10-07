import { cache } from "react";

import { acornApiUrl } from "../config";
import { adminSessionToken } from "./cookie";
import { ADMIN_AUTH_ME_PATH } from "./constants";

/** The admin email behind this browser's session cookie, or null when signed out. */
export const currentAdminEmail = cache(async (): Promise<string | null> => {
  const token = await adminSessionToken();
  if (!token) return null;
  const response = await fetch(`${acornApiUrl()}${ADMIN_AUTH_ME_PATH}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json()) as { session?: { email?: string } };
  const email = body.session?.email?.trim();
  return email || null;
});
