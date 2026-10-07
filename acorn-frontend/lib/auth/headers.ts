import { ACORN_CLIENT, ACORN_CLIENT_HEADER } from "@acorn/shared/api";

/**
 * Headers for an Acorn API call from this site's server: the session as a bearer
 * token, JSON when there is a body, and the client name for usage stats.
 */
export function acornHeaders(token: string, init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set(ACORN_CLIENT_HEADER, ACORN_CLIENT.web);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return headers;
}
