import { RUN_OUTCOME } from "@acorn/shared/run-types";
import { describeError, describeRunFailure } from "@acorn/shared/user-messages";
import { useEffect, useRef } from "react";

import { pushAcornNotice } from "./acorn-notice";

import type { TabPipelineMap } from "../tab-pipeline-session";
import type { AcornNoticePayload } from "../types";
import type { PipelineProgress } from "@acorn/shared/pipeline-types";

/** The notice for work on one tab that has just ended; null while it runs or idles. */
function endNotice(progress: PipelineProgress): AcornNoticePayload | null {
  if (progress.phase === "error") {
    const failure = progress.run?.report?.failure;
    const errored = progress.run?.report?.outcome === RUN_OUTCOME.failed;
    // Words for a person; the raw error stays in the Logs tab.
    const said = failure
      ? describeRunFailure(failure)
      : describeError({
          code: progress.errorCode,
          status: progress.errorStatus,
          message: progress.error || progress.message,
        });
    return {
      kind: "error",
      title: said.title || (errored ? "Run stopped" : "Run couldn’t finish"),
      detail: said.detail,
    };
  }
  if (progress.phase !== "done") return null;
  if (progress.run?.report?.outcome === RUN_OUTCOME.completed) {
    return { kind: "success", title: "Application sent", detail: progress.message };
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
      if (!notice || key == null || !before.has(tabKey) || before.get(tabKey) === key) continue;
      if (!Number.isInteger(tabId)) continue;
      pushAcornNotice({ ...notice, id: `${tabKey}:${key}`, tabId });
    }
    seen.current = now;
  }, [pipelines]);
}
