import {
  IDLE_PIPELINE_PROGRESS,
  mergePipelineProgress,
  type PipelineProgress,
} from "@acorn/shared/pipeline-types";
import { isRunMap } from "@acorn/shared/run-types";

import { EXTENSION_BUILD } from "./build-version";
import { withStorageLock } from "./storage-lock";

export const TAB_PIPELINES_STORAGE_KEY = "acornTabPipelines";

export type TabPipelineMap = Record<string, PipelineProgress>;

/**
 * What is kept under the key: each tab's progress, stamped with the build that wrote it. The browser keeps
 * session storage while the service worker is restarted and picks up a new build, so what another build
 * wrote can be there in a shape this one cannot read (a run's map without the fields this build draws),
 * and is dropped.
 */
interface StoredTabPipelines {
  build: string;
  pipelines: TabPipelineMap;
}

const writeTail = new Map<number, Promise<void>>();

/**
 * A tab's progress as this build can read it: a run's map that is not of this build's shape is left out,
 * so the panel shows the run without a map rather than fail on it.
 */
export function readableProgress(progress: PipelineProgress): PipelineProgress {
  const map = progress.run?.map;
  if (map === undefined || isRunMap(map)) return progress;
  const { map: _unreadable, ...run } = progress.run ?? {};
  return { ...progress, run: run as PipelineProgress["run"] };
}

/** The tabs' progress out of what the key holds: nothing when another build wrote it, or it is not a map of tabs. */
export function tabPipelinesFromStored(value: unknown): TabPipelineMap {
  if (!value || typeof value !== "object") return {};
  const stored = value as Partial<StoredTabPipelines>;
  if (
    stored.build !== EXTENSION_BUILD ||
    !stored.pipelines ||
    typeof stored.pipelines !== "object"
  ) {
    return {};
  }
  const out: TabPipelineMap = {};
  for (const [key, progress] of Object.entries(stored.pipelines)) {
    if (progress && typeof progress === "object") out[key] = readableProgress(progress);
  }
  return out;
}

async function readMap(): Promise<TabPipelineMap> {
  const stored = await chrome.storage.session.get(TAB_PIPELINES_STORAGE_KEY);
  return tabPipelinesFromStored(stored[TAB_PIPELINES_STORAGE_KEY]);
}

async function writeMap(pipelines: TabPipelineMap): Promise<void> {
  const stored: StoredTabPipelines = { build: EXTENSION_BUILD, pipelines };
  await chrome.storage.session.set({ [TAB_PIPELINES_STORAGE_KEY]: stored });
}

export async function listTabPipelines(): Promise<TabPipelineMap> {
  return readMap();
}

export async function recordTabPipeline(
  tabId: number,
  next: PipelineProgress,
): Promise<PipelineProgress> {
  return withStorageLock(TAB_PIPELINES_STORAGE_KEY, async () => {
    const map = await readMap();
    const key = String(tabId);
    const prev = map[key] ?? IDLE_PIPELINE_PROGRESS;
    const merged = mergePipelineProgress(prev, next);
    map[key] = merged;
    await writeMap(map);
    return merged;
  });
}

/** Serialize per-tab writes so overlapping progress events cannot clobber each other. */
export function queueTabPipeline(tabId: number, next: PipelineProgress): Promise<void> {
  const prev = writeTail.get(tabId) ?? Promise.resolve();
  const queued = prev
    .then(() => recordTabPipeline(tabId, next))
    .then(() => undefined)
    .catch(() => undefined);
  writeTail.set(tabId, queued);
  return queued;
}

export async function clearTabPipeline(tabId: number): Promise<void> {
  return withStorageLock(TAB_PIPELINES_STORAGE_KEY, async () => {
    const map = await readMap();
    if (!(String(tabId) in map)) return;
    delete map[String(tabId)];
    await writeMap(map);
  });
}

export async function rekeyTabPipeline(fromTabId: number, toTabId: number): Promise<void> {
  return withStorageLock(TAB_PIPELINES_STORAGE_KEY, async () => {
    if (fromTabId === toTabId) return;
    await writeTail.get(fromTabId);
    writeTail.delete(fromTabId);
    const map = await readMap();
    const fromKey = String(fromTabId);
    const toKey = String(toTabId);
    if (!(fromKey in map)) return;
    const row = map[fromKey];
    delete map[fromKey];
    map[toKey] = row;
    await writeMap(map);
  });
}
