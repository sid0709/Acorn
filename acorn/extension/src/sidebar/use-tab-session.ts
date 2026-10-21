import {
  IDLE_PIPELINE_PROGRESS,
  mergePipelineProgress,
  type PipelineProgress,
} from "@acorn/shared/pipeline-types";
import { useEffect, useState } from "react";

import {
  listTabPipelines,
  readableProgress,
  TAB_PIPELINES_STORAGE_KEY,
  tabPipelinesFromStored,
  type TabPipelineMap,
} from "../tab-pipeline-session";
import { MSG } from "../types";

export function useTabSession(activeTabId: number | null) {
  const [pipelines, setPipelines] = useState<TabPipelineMap>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const progress = await listTabPipelines();
      if (!alive) return;
      setPipelines(progress);
    })();

    const onChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
      changes,
      area,
    ) => {
      if (area !== "session") return;
      if (changes[TAB_PIPELINES_STORAGE_KEY]) {
        setPipelines(tabPipelinesFromStored(changes[TAB_PIPELINES_STORAGE_KEY].newValue));
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  useEffect(() => {
    const onMessage = (message: { type?: string; tabId?: number; progress?: PipelineProgress }) => {
      if (message.type !== MSG.PIPELINE_PROGRESS || !message.progress) return;
      if (typeof message.tabId !== "number") return;
      const tabId = message.tabId;
      const next = readableProgress(message.progress);
      setPipelines((prev) => {
        const key = String(tabId);
        return {
          ...prev,
          [key]: mergePipelineProgress(prev[key] ?? IDLE_PIPELINE_PROGRESS, next),
        };
      });
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const tabKey = activeTabId != null ? String(activeTabId) : null;
  const progress = tabKey ? (pipelines[tabKey] ?? IDLE_PIPELINE_PROGRESS) : IDLE_PIPELINE_PROGRESS;

  return {
    pipelines,
    progress,
    setPipelines,
  };
}
