import {
  IDLE_PIPELINE_PROGRESS,
  mergePipelineProgress,
  type PipelineProgress,
} from "@acorn/shared/pipeline-types";
import { describeError } from "@acorn/shared/user-messages";
import { useCallback } from "react";

import { fetchStoredJobDescription } from "../pipeline/api/job-files";
import { MSG, type AcornNoticePayload } from "../types";

import { pushAcornNotice } from "./acorn-notice";
import { sendMessage } from "./runtime";

import type { ResumeMode } from "../tab-job-generate-session";
import type { useTabSession } from "./use-tab-session";

type TabSession = ReturnType<typeof useTabSession>;

/** A notice about work on one Chrome tab. It stays hidden while another tab is focused. */
function notify(tabId: number | null | undefined, notice: AcornNoticePayload): void {
  // An error a person can act on is said in plain words; the raw text stays in the log.
  const said =
    notice.kind === "error" && notice.detail ? describeError({ message: notice.detail }) : null;
  if (said?.known) notice = { ...notice, title: said.title, detail: said.detail };
  pushAcornNotice(typeof tabId === "number" ? { ...notice, tabId } : notice);
}

/** Actions that start or steer work on a Chrome tab: Run, and Generate / Recommend for a job. */
export function useTabWork({
  activeTabId,
  tabJob,
  setPipelines,
  tabWorkBusy,
}: {
  activeTabId: number | null;
  tabJob: TabSession["tabJob"];
  setPipelines: TabSession["setPipelines"];
  tabWorkBusy: boolean;
}) {
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

  /** Run on the active tab; `continueRun` carries on from where the last run stopped. */
  const startRun = useCallback(
    async (continueRun = false) => {
      const tabId = activeTabId;
      if (tabWorkBusy || tabId == null) return;
      setTabProgress(tabId, {
        phase: "fetching",
        message: continueRun ? "Continuing…" : "Starting…",
      });
      try {
        const res = await sendMessage<{ ok?: boolean; error?: string }>({
          type: MSG.START_RUN,
          tabId,
          continueRun,
        });
        if (res?.error) {
          const err = String(res.error);
          if (/sign in/i.test(err)) {
            setTabProgress(tabId, { phase: "idle", message: "Sign in to Acorn to run" });
            notify(tabId, {
              kind: "error",
              title: "Sign in required",
              detail: "Sign in to Run.",
            });
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
    },
    [activeTabId, tabWorkBusy, setTabProgress],
  );

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
        notify(tabId, { kind: "error", title: "Couldn’t stop", detail: String(res.error) });
      }
    } catch (err) {
      notify(tabId, {
        kind: "error",
        title: "Couldn’t stop",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }, [activeTabId]);

  /** Gives the person's answer to the question the Run on the active tab is waiting on. */
  const answerRun = useCallback(
    async (answer: string) => {
      const tabId = activeTabId;
      if (tabId == null) return;
      try {
        const res = await sendMessage<{ ok?: boolean; error?: string }>({
          type: MSG.ANSWER_RUN,
          tabId,
          answer,
        });
        if (res?.error) {
          notify(tabId, {
            kind: "error",
            title: "Couldn’t send your answer",
            detail: String(res.error),
          });
        }
      } catch (err) {
        notify(tabId, {
          kind: "error",
          title: "Couldn’t send your answer",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [activeTabId],
  );

  const startJobWork = useCallback(
    async (mode: ResumeMode, opts: { continue?: boolean } = {}) => {
      const tabId = activeTabId;
      const jobId = tabJob?.jobId ?? "";
      if (!jobId) {
        notify(tabId, {
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
        notify(tabId, {
          kind: "error",
          title: mode === "recommend" ? "Couldn’t recommend" : "Couldn’t generate",
          detail: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      try {
        const res = await sendMessage<{ ok?: boolean; error?: string }>({
          type: mode === "recommend" ? MSG.START_JOB_RECOMMEND : MSG.START_JOB_GENERATE,
          jobId,
          tabId: activeTabId,
          continue: Boolean(opts.continue),
          jobDescription,
        });
        if (!res?.ok) {
          notify(tabId, {
            kind: "error",
            title: mode === "recommend" ? "Couldn’t recommend" : "Couldn’t generate",
            detail: res?.error || "Try again.",
          });
        }
      } catch (err) {
        notify(tabId, {
          kind: "error",
          title: mode === "recommend" ? "Couldn’t recommend" : "Couldn’t generate",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [activeTabId, tabJob?.jobId],
  );

  return {
    startRun,
    stopRun,
    answerRun,
    startJobWork,
  };
}
