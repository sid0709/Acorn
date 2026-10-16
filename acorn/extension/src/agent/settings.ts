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
 * Whether a run surveys a long page from the top on its first look. Off, so the job description
 * is not photographed before the form. After a résumé is attached the server asks for a survey
 * from where the page is down to the bottom (`surveyFrom: "down"`), which does not use this flag.
 */
export const AGENT_SURVEY = false;

export function getAgentUrl(): string {
  return DEFAULT_AGENT_URL;
}
