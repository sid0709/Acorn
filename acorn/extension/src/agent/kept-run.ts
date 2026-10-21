/**
 * A run that stopped and can be continued. The agent server keeps its memory (notes, history,
 * cost) for a while; this keeps the session id so Continue takes it back up instead of starting
 * over. It lives in session storage beside the tab's other state, so it survives the service
 * worker being parked and goes with the browser session.
 *
 * Keyed by every tab the run used, so Continue works from whichever of them the person is on.
 */

import { withStorageLock } from "../storage-lock";

import type { JobPage } from "./completed-run";
import type { AgentMemory } from "@acorn/shared/agent-contract";

export const KEPT_RUNS_STORAGE_KEY = "acornKeptAgentRuns";

export interface KeptRun {
  /** The agent server's session for this run. */
  sessionId: string;
  /** The run's id in the tab's log, so a continued run goes on in the same log. */
  runId: string;
  /** The tab the run was working in when it stopped. */
  tabId: number;
  /** Whether the run was told to stop before Submit: the agent's prompt was fixed when it started. */
  stopBeforeSubmit: boolean;
  /** What the run knew when it stopped, so Continue can go on from it if the agent forgot the session. */
  memory?: AgentMemory;
  /** The page the run began on, so a Run that ends sent still counts for the job it was started on. */
  job?: JobPage;
  /** How long the run has worked over its legs so far (ms), and what the models have cost (dollars). */
  workMs?: number;
  costUsd?: number;
}

type KeptRunMap = Record<string, KeptRun>;

async function readMap(): Promise<KeptRunMap> {
  const stored = await chrome.storage.session.get(KEPT_RUNS_STORAGE_KEY);
  const raw = stored[KEPT_RUNS_STORAGE_KEY];
  return raw && typeof raw === "object" ? (raw as KeptRunMap) : {};
}

async function writeMap(map: KeptRunMap): Promise<void> {
  await chrome.storage.session.set({ [KEPT_RUNS_STORAGE_KEY]: map });
}

/** Keeps a stopped run for every tab it used. A run kept before for these tabs is replaced. */
export function keepRun(tabIds: readonly number[], run: KeptRun): Promise<void> {
  return withStorageLock(KEPT_RUNS_STORAGE_KEY, async () => {
    const map = await readMap();
    for (const tabId of tabIds) map[String(tabId)] = run;
    await writeMap(map);
  });
}

/** The run kept for this tab, if any, without taking it. */
export async function getKeptRun(tabId: number): Promise<KeptRun | null> {
  return (await readMap())[String(tabId)] ?? null;
}

/**
 * Takes the run kept for this tab out of storage and returns it: it is going on (Continue) or
 * being dropped (a new Run). Every tab it was kept for lets go of it.
 */
export function takeKeptRun(tabId: number): Promise<KeptRun | null> {
  return withStorageLock(KEPT_RUNS_STORAGE_KEY, async () => {
    const map = await readMap();
    const run = map[String(tabId)];
    if (!run) return null;
    for (const [key, held] of Object.entries(map)) {
      if (held.sessionId === run.sessionId) delete map[key];
    }
    await writeMap(map);
    return run;
  });
}

/**
 * A tab closed. A run kept for the tab it worked in is over, and is returned for the caller to end on
 * the server; a run that only used the tab can still go on elsewhere.
 */
export function forgetKeptRunOfClosedTab(tabId: number): Promise<KeptRun | null> {
  return withStorageLock(KEPT_RUNS_STORAGE_KEY, async () => {
    const map = await readMap();
    const run = map[String(tabId)];
    if (!run) return null;
    if (run.tabId !== tabId) {
      delete map[String(tabId)];
      await writeMap(map);
      return null;
    }
    for (const [key, held] of Object.entries(map)) {
      if (held.sessionId === run.sessionId) delete map[key];
    }
    await writeMap(map);
    return run;
  });
}

/** Chrome swapped a tab for another (a prerendered page): the kept run follows it. */
export function rekeyKeptRun(fromTabId: number, toTabId: number): Promise<void> {
  return withStorageLock(KEPT_RUNS_STORAGE_KEY, async () => {
    if (fromTabId === toTabId) return;
    const map = await readMap();
    let changed = false;
    for (const [key, held] of Object.entries(map)) {
      const moved = held.tabId === fromTabId ? { ...held, tabId: toTabId } : held;
      if (key === String(fromTabId)) {
        delete map[key];
        map[String(toTabId)] = moved;
        changed = true;
      } else if (moved !== held) {
        map[key] = moved;
        changed = true;
      }
    }
    if (changed) await writeMap(map);
  });
}
