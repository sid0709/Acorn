/**
 * Where a run stopped, per tab, so Continue carries on from that point instead of
 * starting over: what it learned about the site's account, its mail state, and
 * which page it had already filled. Kept for the browser session.
 */

import type { AccountAttempt } from "@acorn/shared/run-types";

/** chrome.storage.session key of each tab's run checkpoint. */
export const RUN_CHECKPOINTS_STORAGE_KEY = "acornRunCheckpoints";

export interface RunCheckpoint {
  /** Account steps sent so far, with the site each was sent on. */
  accountHistory: { site: string; attempt: AccountAttempt }[];
  /** Sites where a reset link from the mail was opened. */
  resetLinkSites: string[];
  /** Codes and links taken from the mail so far. */
  mailVerifications: number;
  /** The signature of the page the run had filled when it stopped; null when none. */
  filledSignature: string | null;
  /** The page the run started on: the posting it is applying to. */
  startUrl: string;
  /** Pages the run moved through before it stopped. */
  pages: number;
}

type CheckpointMap = Record<string, RunCheckpoint>;

async function readMap(): Promise<CheckpointMap> {
  const stored = await chrome.storage.session.get([RUN_CHECKPOINTS_STORAGE_KEY]);
  const map = stored[RUN_CHECKPOINTS_STORAGE_KEY] as CheckpointMap | undefined;
  return map && typeof map === "object" ? map : {};
}

export async function getRunCheckpoint(tabId: number): Promise<RunCheckpoint | null> {
  return (await readMap())[String(tabId)] ?? null;
}

export async function saveRunCheckpoint(tabId: number, checkpoint: RunCheckpoint): Promise<void> {
  const map = await readMap();
  map[String(tabId)] = checkpoint;
  await chrome.storage.session.set({ [RUN_CHECKPOINTS_STORAGE_KEY]: map });
}

export async function clearRunCheckpoint(tabId: number): Promise<void> {
  const map = await readMap();
  delete map[String(tabId)];
  await chrome.storage.session.set({ [RUN_CHECKPOINTS_STORAGE_KEY]: map });
}

/** A run's memory at its start: a checkpoint's (Continue), or empty for a new run. */
export function restoredRun(checkpoint: RunCheckpoint | null | undefined): RunCheckpoint {
  return {
    accountHistory: [...(checkpoint?.accountHistory ?? [])],
    resetLinkSites: [...(checkpoint?.resetLinkSites ?? [])],
    mailVerifications: checkpoint?.mailVerifications ?? 0,
    filledSignature: checkpoint?.filledSignature ?? null,
    startUrl: checkpoint?.startUrl ?? "",
    pages: checkpoint?.pages ?? 0,
  };
}
