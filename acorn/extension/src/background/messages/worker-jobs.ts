import { openWorkerJobInTab } from "../../open-worker-job";
import { getTabJob } from "../../tab-job-session";
import { resolvePreferredTabId } from "../tab-target";

import type { RuntimeMessage, SendResponse } from "./shared";

export function handleOpenWorkerJob(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): void {
  void (async () => {
    try {
      const applyUrl = String(message.applyUrl || "").trim();
      const jobId = String(message.jobId || "").trim();
      if (!jobId) {
        sendResponse({ ok: false, error: "Missing job id" });
        return;
      }
      if (!applyUrl) {
        sendResponse({ ok: false, error: "This job has no apply URL" });
        return;
      }
      const preferredTabId = await resolvePreferredTabId(sender, message.tabId);
      const attachedTabId =
        typeof message.attachedTabId === "number" && Number.isFinite(message.attachedTabId)
          ? message.attachedTabId
          : null;
      const opened = await openWorkerJobInTab({
        preferredTabId,
        attachedTabId,
        job: {
          jobId,
          resumeId:
            typeof message.resumeId === "string" && message.resumeId.trim()
              ? message.resumeId.trim()
              : null,
          resumeStack:
            typeof message.resumeStack === "string" && message.resumeStack.trim()
              ? message.resumeStack.trim()
              : null,
          applyUrl,
          title: String(message.title || ""),
          company: String(message.company || ""),
        },
      });
      sendResponse({ ok: true, tabId: opened.tabId, reused: opened.reused });
    } catch (err) {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}

export function handleGetTabJob(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): void {
  void (async () => {
    let tabId = typeof message.tabId === "number" ? message.tabId : (sender.tab?.id ?? null);
    if (!tabId) {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      tabId = tab?.id ?? null;
    }
    if (!tabId) {
      sendResponse({ ok: false, job: null });
      return;
    }
    sendResponse({ ok: true, job: await getTabJob(tabId) });
  })();
}
