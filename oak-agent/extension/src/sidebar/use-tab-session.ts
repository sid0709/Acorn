import { useEffect, useMemo, useState } from "react";
import {
  IDLE_PIPELINE_PROGRESS,
  mergePipelineProgress,
  type PipelineProgress,
} from "../../../shared/pipeline-types";
import {
  listPages,
  TAB_PAGES_STORAGE_KEY,
  type OakPageBinding,
  type PageMap,
} from "../tab-page-session";
import {
  listTabPipelines,
  TAB_PIPELINES_STORAGE_KEY,
  type TabPipelineMap,
} from "../tab-pipeline-session";
import { MSG } from "../types";

export function useTabSession(activeTabId: number | null) {
  const [pageMap, setPageMap] = useState<PageMap>({});
  const [pipelines, setPipelines] = useState<TabPipelineMap>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [pages, progress] = await Promise.all([listPages(), listTabPipelines()]);
      if (!alive) return;
      setPageMap(pages);
      setPipelines(progress);
    })();

    const onChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
      changes,
      area,
    ) => {
      if (area !== "session") return;
      if (changes[TAB_PAGES_STORAGE_KEY]) {
        const next = changes[TAB_PAGES_STORAGE_KEY].newValue;
        setPageMap(next && typeof next === "object" ? (next as PageMap) : {});
      }
      if (changes[TAB_PIPELINES_STORAGE_KEY]) {
        const next = changes[TAB_PIPELINES_STORAGE_KEY].newValue;
        setPipelines(next && typeof next === "object" ? (next as TabPipelineMap) : {});
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
      const next = message.progress;
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
  const page: OakPageBinding | null = tabKey ? (pageMap[tabKey] ?? null) : null;
  const progress = tabKey ? (pipelines[tabKey] ?? IDLE_PIPELINE_PROGRESS) : IDLE_PIPELINE_PROGRESS;

  const pageList = useMemo(() => {
    return Object.values(pageMap).sort((a, b) => (a.rememberedAt < b.rememberedAt ? 1 : -1));
  }, [pageMap]);

  return {
    page,
    pageList,
    pipelines,
    progress,
    setPipelines,
  };
}
