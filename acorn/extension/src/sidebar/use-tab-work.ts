import { useCallback, useEffect, useState } from "react";
import { FILL_MODE, type FillMode } from "@acorn/shared/field-issues";
import {
  IDLE_PIPELINE_PROGRESS,
  mergePipelineProgress,
  type PipelineProgress,
} from "@acorn/shared/pipeline-types";
import {
  patchCustomTab,
  type CustomResumeMode,
  type AcornCustomTabBinding,
} from "../tab-custom-session";
import { fetchStoredJobDescription } from "../pipeline/api/job-files";
import { MSG, type PipelineSource } from "../types";
import { pushAcornNotice } from "./acorn-notice";
import { sendMessage } from "./runtime";
import type { AcornMainTab } from "./SidebarNav";
import type { useTabSession } from "./use-tab-session";

type TabSession = ReturnType<typeof useTabSession>;

/**
 * Actions that start or steer work on a Chrome tab: Fill, Remember / Forget / Focus a
 * Custom tab, and Generate / Recommend for a Fill job or a Custom tab.
 */
export function useTabWork({
  activeTabId,
  mainTab,
  tabJob,
  customTab,
  setPipelines,
  tabWorkBusy,
}: {
  activeTabId: number | null;
  mainTab: AcornMainTab;
  tabJob: TabSession["tabJob"];
  customTab: TabSession["customTab"];
  setPipelines: TabSession["setPipelines"];
  tabWorkBusy: boolean;
}) {
  const [remembering, setRemembering] = useState(false);
  const [customResumeMode, setCustomResumeMode] = useState<CustomResumeMode>("generate");

  useEffect(() => {
    if (customTab == null) return;
    setCustomResumeMode(customTab.resumeMode);
  }, [customTab?.tabId, customTab?.resumeMode]);

  const setTabProgress = useCallback(
    (tabId: number, next: PipelineProgress) => {
      setPipelines((prev) => {
        const key = String(tabId);
        return {
          ...prev,
          [key]: mergePipelineProgress(prev[key] ?? IDLE_PIPELINE_PROGRESS, next),
        };
      });
    },
    [setPipelines],
  );

  const startPipeline = useCallback(
    async (source: PipelineSource = "fill", mode: FillMode = FILL_MODE.fill) => {
      const tabId = activeTabId;
      if (tabWorkBusy || tabId == null) return;
      if (source === "custom" && !customTab) {
        pushAcornNotice({
          kind: "info",
          title: "Remember this tab first",
          detail: "Custom Fill only runs on a remembered tab.",
        });
        return;
      }
      setTabProgress(tabId, { phase: "fetching", message: "Starting…", mode });
      try {
        const res = await sendMessage<{ ok?: boolean; error?: string }>({
          type: MSG.START_PIPELINE,
          tabId,
          source,
          mode,
        });
        if (res?.error) {
          const err = String(res.error);
          if (/sign in/i.test(err)) {
            setTabProgress(tabId, {
              phase: "idle",
              message: "Sign in to Acorn to run a fill",
            });
            pushAcornNotice({
              kind: "error",
              title: "Sign in required",
              detail: "Sign in to run Fill.",
            });
            return;
          }
          setTabProgress(tabId, {
            phase: "error",
            message: "Failed to start",
            error: err,
          });
          return;
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        setTabProgress(tabId, {
          phase: "error",
          message: "Failed to start",
          error: detail,
        });
      }
    },
    [activeTabId, customTab, tabWorkBusy, setTabProgress],
  );

  const startRun = useCallback(async () => {
    const tabId = activeTabId;
    if (tabWorkBusy || tabId == null) return;
    setTabProgress(tabId, { phase: "fetching", message: "Starting…" });
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.START_RUN,
        tabId,
      });
      if (res?.error) {
        const err = String(res.error);
        if (/sign in/i.test(err)) {
          setTabProgress(tabId, { phase: "idle", message: "Sign in to Acorn to run" });
          pushAcornNotice({ kind: "error", title: "Sign in required", detail: "Sign in to Run." });
          return;
        }
        setTabProgress(tabId, { phase: "error", message: "Failed to start", error: err });
      }
    } catch (err) {
      setTabProgress(tabId, {
        phase: "error",
        message: "Failed to start",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [activeTabId, tabWorkBusy, setTabProgress]);

  /** Stop the Run on the active tab at once; the page is left as it is. */
  const stopRun = useCallback(async () => {
    const tabId = activeTabId;
    if (tabId == null) return;
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.STOP_RUN,
        tabId,
      });
      if (res?.error) {
        pushAcornNotice({ kind: "error", title: "Couldn’t stop", detail: String(res.error) });
      }
    } catch (err) {
      pushAcornNotice({
        kind: "error",
        title: "Couldn’t stop",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }, [activeTabId]);

  const rememberFocusedTab = useCallback(async () => {
    const tabId = activeTabId;
    if (tabId == null) return;
    setRemembering(true);
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.REMEMBER_CUSTOM_TAB,
        tabId,
        resumeMode: customResumeMode,
      });
      if (!res?.ok) {
        pushAcornNotice({
          kind: "error",
          title: "Couldn’t remember tab",
          detail: res?.error || "Try again on this page.",
        });
        return;
      }
      pushAcornNotice({ kind: "success", title: "Tab remembered" });
    } catch (err) {
      pushAcornNotice({
        kind: "error",
        title: "Couldn’t remember tab",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRemembering(false);
    }
  }, [activeTabId, customResumeMode]);

  const forgetCustomTab = useCallback(async (tabId: number) => {
    void chrome.tabs.remove(tabId).catch(() => undefined);
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.FORGET_CUSTOM_TAB,
        tabId,
      });
      if (!res?.ok) {
        pushAcornNotice({
          kind: "error",
          title: "Couldn’t forget tab",
          detail: res?.error || "Try again.",
        });
      }
    } catch (err) {
      pushAcornNotice({
        kind: "error",
        title: "Couldn’t forget tab",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const focusCustomTab = useCallback(async (tabId: number) => {
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.FOCUS_CUSTOM_TAB,
        tabId,
      });
      if (!res?.ok) {
        pushAcornNotice({
          kind: "error",
          title: "Couldn’t switch tab",
          detail: res?.error || "That tab is no longer open.",
        });
      }
    } catch (err) {
      pushAcornNotice({
        kind: "error",
        title: "Couldn’t switch tab",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const startJobWork = useCallback(
    async (mode: CustomResumeMode, opts: { continue?: boolean } = {}) => {
      const jobId = tabJob?.jobId ?? "";
      if (!jobId) {
        pushAcornNotice({
          kind: "info",
          title: "No job on this tab",
          detail: "Generate uses the job description saved for this tab.",
        });
        return;
      }
      let jobDescription = "";
      try {
        jobDescription = await fetchStoredJobDescription(jobId);
      } catch (err) {
        pushAcornNotice({
          kind: "error",
          title: mode === "recommend" ? "Couldn’t recommend" : "Couldn’t generate",
          detail: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      setCustomResumeMode(mode);
      try {
        const res = await sendMessage<{ ok?: boolean; error?: string }>({
          type: mode === "recommend" ? MSG.START_JOB_RECOMMEND : MSG.START_JOB_GENERATE,
          jobId,
          tabId: activeTabId,
          continue: Boolean(opts.continue),
          jobDescription,
        });
        if (!res?.ok) {
          pushAcornNotice({
            kind: "error",
            title: mode === "recommend" ? "Couldn’t recommend" : "Couldn’t generate",
            detail: res?.error || "Try again.",
          });
        }
      } catch (err) {
        pushAcornNotice({
          kind: "error",
          title: mode === "recommend" ? "Couldn’t recommend" : "Couldn’t generate",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [activeTabId, tabJob?.jobId],
  );

  const startCustomWork = useCallback(
    async (
      mode: CustomResumeMode,
      opts: { continue?: boolean; tab?: AcornCustomTabBinding } = {},
    ) => {
      const tabId = opts.tab?.tabId ?? activeTabId;
      if (tabId == null) return;
      if (!opts.tab && tabWorkBusy) return;
      if (mainTab === "fill" && mode !== "recommend") {
        await startJobWork(mode, { continue: opts.continue });
        return;
      }
      if (mode !== "recommend" && !customTab && !opts.tab) return;
      setCustomResumeMode(mode);
      try {
        if (!customTab && !opts.tab) {
          const remembered = await sendMessage<{ ok?: boolean; error?: string }>({
            type: MSG.REMEMBER_CUSTOM_TAB,
            tabId,
            resumeMode: mode,
          });
          if (!remembered?.ok) {
            pushAcornNotice({
              kind: "error",
              title: mode === "recommend" ? "Couldn’t recommend" : "Couldn’t generate",
              detail: remembered?.error || "Try again on this page.",
            });
            return;
          }
        } else if ((opts.tab ?? customTab)?.resumeMode !== mode) {
          await patchCustomTab(tabId, { resumeMode: mode });
        }
        const res = await sendMessage<{ ok?: boolean; error?: string }>({
          type: mode === "recommend" ? MSG.START_CUSTOM_RECOMMEND : MSG.START_CUSTOM_GENERATE,
          tabId,
          continue: Boolean(opts.continue),
        });
        if (!res?.ok) {
          pushAcornNotice({
            kind: "error",
            title: mode === "recommend" ? "Couldn’t recommend" : "Couldn’t generate",
            detail: res?.error || "Try again on this page.",
          });
        }
      } catch (err) {
        pushAcornNotice({
          kind: "error",
          title: mode === "recommend" ? "Couldn’t recommend" : "Couldn’t generate",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [activeTabId, customTab, mainTab, startJobWork, tabWorkBusy],
  );

  return {
    remembering,
    startPipeline,
    startRun,
    stopRun,
    rememberFocusedTab,
    forgetCustomTab,
    focusCustomTab,
    startJobWork,
    startCustomWork,
  };
}
