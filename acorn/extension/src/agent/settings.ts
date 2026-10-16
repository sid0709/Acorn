/**
 * Where the agent server is. It is per browser: the server runs on this computer, beside the
 * applicant's profile and résumés.
 */

import { acornHosts } from "@acorn/shared/api";

const hosts = acornHosts(import.meta.env.MODE);

/** The agent server's address. Override per build with VITE_ACORN_AGENT_URL. */
export const DEFAULT_AGENT_URL = (
  import.meta.env.VITE_ACORN_AGENT_URL?.trim() || hosts.agent
).replace(/\/$/, "");

export function getAgentUrl(): string {
  return DEFAULT_AGENT_URL;
}
