/**
 * Where the agent server is, and whether Run uses it. Both are per browser: the server
 * runs on this computer, beside the applicant's profile and résumés.
 */

import { acornHosts } from "@acorn/shared/api";

const hosts = acornHosts(import.meta.env.MODE);

/** The agent server's address. Override per build with VITE_ACORN_AGENT_URL. */
export const DEFAULT_AGENT_URL = (
  import.meta.env.VITE_ACORN_AGENT_URL?.trim() || hosts.agent
).replace(/\/$/, "");

/** chrome.storage.local key of the Agent Run switch. */
export const AGENT_MODE_STORAGE_KEY = "acornAgentMode";

/** Whether Run is driven by the agent. On unless the person turned it off. */
export async function getAgentMode(): Promise<boolean> {
  const stored = await chrome.storage.local.get([AGENT_MODE_STORAGE_KEY]);
  return stored[AGENT_MODE_STORAGE_KEY] !== false;
}

export async function setAgentMode(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [AGENT_MODE_STORAGE_KEY]: enabled });
}

export function getAgentUrl(): string {
  return DEFAULT_AGENT_URL;
}
