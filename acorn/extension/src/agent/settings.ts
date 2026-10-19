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

/**
 * Whether the run may make a quick text pass before the model looks at a page: the page's plain fields
 * (text boxes, native lists, radio groups, checkboxes) are listed as text, answered in one model call
 * that reads no image, and typed with real keystrokes, so the model's own look checks a first draft
 * instead of discovering the form (docs 19.4m). On unless a build sets VITE_ACORN_AGENT_PREFILL=false: the
 * deployed build reads no .env, and a pass that is off there is a run of the image agent alone.
 */
export const AGENT_PREFILL =
  import.meta.env.VITE_ACORN_AGENT_PREFILL?.trim().toLowerCase() !== "false";

export function getAgentUrl(): string {
  return DEFAULT_AGENT_URL;
}
