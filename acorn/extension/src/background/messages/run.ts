import { getAccessToken, getAcornApiUrl } from "../../auth/acorn-auth";
import { runOrchestrator } from "../../pipeline/run-orchestrator";
import { syncAutoFocus } from "../auto-focus";
import { getRunCheckpoint } from "../../pipeline/run-checkpoint";
import { getStopBeforeSubmit } from "../../run-settings";
import { beginRunStop, claimRunStopTab, endRunStop, stopRunOnTab } from "../run-stop";
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
    const stop = beginRunStop(tabId);
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
        signal: stop.signal,
        // Continue: carry on from where the last run on this tab stopped.
        resumeFrom: message.continueRun === true ? await getRunCheckpoint(tabId) : null,
        // The message may ask for it (a test run); otherwise the sidebar switch decides.
        stopBeforeSubmit: await stopBeforeSubmitFor(message),
        emit: (tabIds, progress) => {
          for (const id of tabIds) broadcastPipelineProgress(id, progress);
        },
        claimTab: (id) => {
          claimed.add(id);
          claimRunStopTab(stop, id);
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
      endRunStop(stop);
      for (const id of claimed) {
        pipelineRunningTabIds.delete(id);
        runTabIds.delete(id);
      }
      syncWorkKeepAlive();
      void syncAutoFocus();
    }
  })();
}

/** Stop before Submit as the start message asks for it, else as the sidebar switch says. */
async function stopBeforeSubmitFor(message: RuntimeMessage): Promise<boolean> {
  const asked: unknown = (message as { stopBeforeSubmit?: unknown }).stopBeforeSubmit;
  return typeof asked === "boolean" ? asked : getStopBeforeSubmit();
}

/** Stop: the Run working on this tab stops at once and leaves the page as it is. */
export function handleStopRun(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): void {
  const tabId = pinnedTabId(message.tabId, sender);
  if (!tabId || !stopRunOnTab(tabId)) {
    sendResponse({ error: "No run is working on this tab" });
    return;
  }
  sendResponse({ ok: true });
}
