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

/** Whether a build setting turns a switch on: "true", "on", "yes" or "1". Unset or anything else is off. */
function switchOn(value: string | undefined): boolean {
  return ["true", "on", "yes", "1"].includes((value ?? "").trim().toLowerCase());
}

/**
 * Whether a run may survey a long page: scroll it from top to bottom taking a screenshot at each stop,
 * so the model plans the whole form from one look. Off, the run sees only the current screen, as a
 * person does, and the page does not move on its own. A survey was never shown to save calls, time,
 * or money (see docs 19), and it scrolls the page in front of the person.
 */
export const AGENT_SURVEY = switchOn(import.meta.env.VITE_ACORN_AGENT_SURVEY);

/**
 * Whether a run uses fast fill: it plans a whole page from one look and carries the plan out zone by
 * zone, with the checks of each zone done while the next one runs (docs 19.4m). Off, a run goes step by
 * step, as it always has. The switch is here so a build can turn the new way on and the old way back
 * on without touching anything else.
 */
export const AGENT_FAST_FILL = switchOn(import.meta.env.VITE_ACORN_AGENT_FAST_FILL);

export function getAgentUrl(): string {
  return DEFAULT_AGENT_URL;
}
