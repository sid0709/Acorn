import { getAccessToken, getAcornApiUrl } from "../../auth/acorn-auth";
import { runOrchestrator } from "../../pipeline/run-orchestrator";
import { syncAutoFocus } from "../auto-focus";
import { broadcastPipelineProgress } from "../socket-connection";
import { pinnedTabId } from "../tab-target";
import {
  customGenerateTabIds,
  pipelineRunningTabIds,
  runTabIds,
  syncWorkKeepAlive,
} from "../work-state";
import { SIGN_IN_FIRST, type RuntimeMessage, type SendResponse } from "./shared";

/** Run: the whole application on this tab, in one click. */
export function handleStartRun(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): void {
  void (async () => {
    const tabId = pinnedTabId(message.tabId, sender);
    if (!tabId) {
      sendResponse({ error: "No tab for Run" });
      return;
    }
    if (pipelineRunningTabIds.has(tabId)) {
      sendResponse({ error: "A run is already working on this tab" });
      return;
    }
    if (customGenerateTabIds.has(tabId)) {
      sendResponse({ error: "Generate or Recommend is running on this tab" });
      return;
    }

    const claimed = new Set<number>([tabId]);
    pipelineRunningTabIds.add(tabId);
    runTabIds.add(tabId);
    syncWorkKeepAlive();
    void syncAutoFocus();
    sendResponse({ ok: true });

    try {
      const token = await getAccessToken();
      if (!token) {
        broadcastPipelineProgress(tabId, {
          phase: "error",
          message: "Sign in required",
          error: SIGN_IN_FIRST,
        });
        return;
      }
      await runOrchestrator({
        tabId,
        preferredFrameId: sender.tab ? (sender.frameId ?? null) : null,
        apiUrl: await getAcornApiUrl(),
        emit: (tabIds, progress) => {
          for (const id of tabIds) broadcastPipelineProgress(id, progress);
        },
        claimTab: (id) => {
          claimed.add(id);
          pipelineRunningTabIds.add(id);
          runTabIds.add(id);
          void syncAutoFocus();
        },
      });
    } catch (err) {
      broadcastPipelineProgress(tabId, {
        phase: "error",
        message: "Failed",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      for (const id of claimed) {
        pipelineRunningTabIds.delete(id);
        runTabIds.delete(id);
      }
      syncWorkKeepAlive();
      void syncAutoFocus();
    }
  })();
}
