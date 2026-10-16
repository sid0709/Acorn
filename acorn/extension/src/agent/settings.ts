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

/**
 * Whether a run may survey a long page: scroll it from top to bottom taking a screenshot at each stop,
 * so the model plans the whole form from one look. Off, the run sees only the current screen, as a
 * person does, and the page does not move on its own. A survey was never shown to save calls, time,
 * or money (see docs 19), and it scrolls the page in front of the person.
 */
export const AGENT_SURVEY = false;

export function getAgentUrl(): string {
  return DEFAULT_AGENT_URL;
}
