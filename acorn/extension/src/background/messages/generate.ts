import { getAccessToken, getAcornApiUrl } from "../../auth/acorn-auth";
import { runJobGenerate } from "../../pipeline/job-generate";
import { runJobRecommend } from "../../pipeline/job-recommend";
import { MSG } from "../../types";
import { patchJobGenerateFailed } from "../generate-failure";
import { pinnedTabId } from "../tab-target";
import { jobGenerateJobIds, syncWorkKeepAlive } from "../work-state";

import { SIGN_IN_FIRST, type RuntimeMessage, type SendResponse } from "./shared";

export function handleStartJobWork(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): void {
  void (async () => {
    const jobId = String(message.jobId || "").trim();
    if (!jobId) {
      sendResponse({ ok: false, error: "Missing job id" });
      return;
    }
    if (jobGenerateJobIds.has(jobId)) {
      sendResponse({ ok: false, error: "Already generating for this job" });
      return;
    }
    const tabId = pinnedTabId(message.tabId, sender);
    jobGenerateJobIds.add(jobId);
    syncWorkKeepAlive();
    sendResponse({ ok: true });
    try {
      const token = await getAccessToken();
      if (!token) {
        throw new Error(SIGN_IN_FIRST);
      }
      const apiUrl = await getAcornApiUrl();
      const storedJd = typeof message.jobDescription === "string" ? message.jobDescription : null;
      const resume = Boolean(message.continue);
      if (message.type === MSG.START_JOB_RECOMMEND) {
        await runJobRecommend({
          jobId,
          tabId,
          apiUrl,
          continue: resume,
          storedJd,
        });
      } else {
        await runJobGenerate({
          jobId,
          tabId,
          apiUrl,
          continue: resume,
          storedJd,
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await patchJobGenerateFailed(jobId, error);
    } finally {
      jobGenerateJobIds.delete(jobId);
      syncWorkKeepAlive();
    }
  })();
}
