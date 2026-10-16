import { runAgent } from "../../agent/runner";
import { getAgentUrl } from "../../agent/settings";
import { getAccessToken } from "../../auth/acorn-auth";
import { getStopBeforeSubmit } from "../../run-settings";
import { syncAutoFocus } from "../auto-focus";
import { answerRunOnTab, awaitRunAnswer } from "../run-answer";
import { beginRunStop, claimRunStopTab, endRunStop, stopRunOnTab } from "../run-stop";
import { broadcastPipelineProgress } from "../socket-connection";
import { pinnedTabId } from "../tab-target";
import { pipelineRunningTabIds, runTabIds, syncWorkKeepAlive } from "../work-state";

import type { RuntimeMessage, SendResponse } from "./shared";

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

    const claimed = new Set<number>([tabId]);
    const stop = beginRunStop(tabId);
    pipelineRunningTabIds.add(tabId);
    runTabIds.add(tabId);
    syncWorkKeepAlive();
    void syncAutoFocus();
    sendResponse({ ok: true });

    try {
      // The agent plans from screenshots; it reads the person's profile and résumés from
      // acorn-backend with their Acorn session, so it needs them signed in (a local development
      // agent reading files ignores the session).
      console.info("[acorn:agent] Run on tab", tabId, "→", getAgentUrl());
      await runAgent({
        tabId,
        agentUrl: getAgentUrl(),
        signal: stop.signal,
        stopBeforeSubmit: await stopBeforeSubmitFor(message),
        accessToken: (await getAccessToken()) ?? undefined,
        emit: (tabIds, progress) => {
          for (const id of tabIds) broadcastPipelineProgress(id, progress);
        },
        waitForAnswer: (signal) => awaitRunAnswer(claimed, signal),
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

/** The person's answer to the question the Run on this tab is waiting on. */
export function handleAnswerRun(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): void {
  const tabId = pinnedTabId(message.tabId, sender);
  const answer = typeof message.answer === "string" ? message.answer : "";
  if (!tabId || !answer || !answerRunOnTab(tabId, answer)) {
    sendResponse({ error: "No run is waiting for an answer on this tab" });
    return;
  }
  sendResponse({ ok: true });
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
