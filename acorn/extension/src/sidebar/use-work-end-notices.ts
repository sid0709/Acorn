import { RUN_OUTCOME } from "@acorn/shared/run-types";
import { describeError, describeRunEnd } from "@acorn/shared/user-messages";
import { useEffect, useRef } from "react";

import { clearAcornNotices, noticeOf, pushAcornNotice } from "./acorn-notice";

import type { TabPipelineMap } from "../tab-pipeline-session";
import type { AcornNoticePayload } from "../types";
import type { PipelineProgress } from "@acorn/shared/pipeline-types";

/**
 * The notice for work on one tab that has just ended, in the catalogue's words (user-messages.ts): sent,
 * already applied, ready to submit, paused, or why it stopped and what to do; null while it runs or idles.
 */
function endNotice(progress: PipelineProgress): AcornNoticePayload | null {
  const report = progress.run?.report;
  if (progress.phase === "error") {
    // Words for a person; the raw error stays in the Logs tab.
    return noticeOf(
      report
        ? describeRunEnd(report)
        : describeError({
            code: progress.errorCode,
            status: progress.errorStatus,
            message: progress.error || progress.message,
          }),
    );
  }
  if (!report) return null;
  if (
    progress.phase === "done" ||
    (progress.phase === "idle" && report.outcome === RUN_OUTCOME.stopped)
  ) {
    return noticeOf(describeRunEnd(report));
  }
  return null;
}

/** Names one ending, so the same ending is never announced twice. */
function endKey(progress: PipelineProgress, notice: AcornNoticePayload): string {
  return [progress.run?.runId, progress.run?.endedAt, notice.title, notice.detail].join("|");
}

/**
 * Announce each tab's work once, when it ends, as a notice tagged with that tab: it
 * shows only while that tab is focused. Endings already on record when the sidebar
 * opens, and tabs merely switched to, are not announced again.
 */
export function useWorkEndNotices(pipelines: TabPipelineMap): void {
  const seen = useRef(new Map<string, string | null>());

  useEffect(() => {
    const before = seen.current;
    const now = new Map<string, string | null>();
    for (const [tabKey, progress] of Object.entries(pipelines)) {
      const notice = endNotice(progress);
      const key = notice ? endKey(progress, notice) : null;
      now.set(tabKey, key);
      const tabId = Number(tabKey);
      if (!Number.isInteger(tabId)) continue;
      // The run on the tab moved on (Continue, Run again): what it waited on is no longer the person's.
      if (!notice && before.get(tabKey)) clearAcornNotices(tabId);
      if (!notice || key == null || !before.has(tabKey) || before.get(tabKey) === key) continue;
      pushAcornNotice({ ...notice, id: `${tabKey}:${key}`, tabId });
    }
    seen.current = now;
  }, [pipelines]);
}
