import { endSession } from "../../agent/client";
import { flushCompletedRuns, recordCompletedRun } from "../../agent/completed-run-sync";
import { forgetKeptRunOfClosedTab, keepRun, takeKeptRun, type KeptRun } from "../../agent/kept-run";
import { runAgent } from "../../agent/runner";
import { getAgentUrl } from "../../agent/settings";
import { getAccessToken } from "../../auth/acorn-auth";
import { answerRunOnTab, awaitRunAnswer } from "../run-answer";
import { groupRunTab } from "../run-group";
import { beginRunStop, claimRunStopTab, endRunStop, stopRunOnTab } from "../run-stop";
import { broadcastPipelineProgress } from "../socket-connection";
import { pinnedTabId } from "../tab-target";
import { pipelineRunningTabIds, runTabIds, syncWorkKeepAlive } from "../work-state";

import type { RuntimeMessage, SendResponse } from "./shared";
import type { RunReport } from "@acorn/shared/run-types";

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
    const started = await startRunOnTab(tabId, {
      continueRun: message.continueRun === true,
      stopBeforeSubmit: stopBeforeSubmitFor(message),
    });
    sendResponse("error" in started ? { error: started.error } : { ok: true });
  })();
}

/** A Run that began: `done` settles with its report when it ends, or null when it threw. */
export type StartedRun = { done: Promise<RunReport | null> } | { error: string };

/**
 * Starts a Run on this tab and returns once it works, without waiting for it to end. The Run's
 * progress goes to the sidebar as it always does; the queue of the Agent tab also waits on `done`.
 */
export async function startRunOnTab(
  tabId: number,
  options: { continueRun?: boolean; stopBeforeSubmit?: boolean } = {},
): Promise<StartedRun> {
  if (pipelineRunningTabIds.has(tabId)) {
    return { error: "A run is already working on this tab" };
  }

  const resume = await resumableRun(tabId, options.continueRun === true);

  const claimed = new Set<number>([tabId]);
  const stop = beginRunStop(tabId);
  pipelineRunningTabIds.add(tabId);
  runTabIds.add(tabId);
  void groupRunTab(tabId);
  syncWorkKeepAlive();
  // A completed run the backend could not take earlier is sent again now.
  void flushCompletedRuns().catch(() => undefined);

  const done = (async (): Promise<RunReport | null> => {
    try {
      // The agent plans from screenshots; it reads the person's profile and résumés from
      // acorn-backend with their Acorn session, so it needs them signed in (a local development
      // agent reading files ignores the session).
      console.info("[acorn:agent] Run on tab", tabId, "→", getAgentUrl());
      return await runAgent({
        tabId,
        agentUrl: getAgentUrl(),
        signal: stop.signal,
        stopBeforeSubmit: options.stopBeforeSubmit === true,
        resume,
        keepRun,
        recordCompleted: recordCompletedRun,
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
          void groupRunTab(id);
        },
      });
    } catch (err) {
      broadcastPipelineProgress(tabId, {
        phase: "error",
        message: "Failed",
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      endRunStop(stop);
      for (const id of claimed) {
        pipelineRunningTabIds.delete(id);
        runTabIds.delete(id);
      }
      syncWorkKeepAlive();
    }
  })();
  return { done };
}

/**
 * The stopped run this start takes back up, when it is a Continue and the agent can still be
 * asked about it. Any run kept for the tab is taken out either way: Continue goes on with it, and
 * a fresh Run leaves it behind, so the agent is told to forget it.
 */
async function resumableRun(tabId: number, continuing: boolean): Promise<KeptRun | undefined> {
  const kept = await takeKeptRun(tabId).catch(() => null);
  if (!kept) return undefined;
  if (
    continuing &&
    (await chrome.tabs.get(kept.tabId).then(
      () => true,
      () => false,
    ))
  )
    return kept;
  await endSession(getAgentUrl(), kept.sessionId);
  return undefined;
}

/** A tab closed: the stopped run kept for it is over, so the agent is told to forget it. */
export async function endKeptRunOfTab(tabId: number): Promise<void> {
  const kept = await forgetKeptRunOfClosedTab(tabId).catch(() => null);
  if (kept) await endSession(getAgentUrl(), kept.sessionId);
}

/** Whether the start message asks the Run to stop at Submit (only tests do; a Run sends the application). */
function stopBeforeSubmitFor(message: RuntimeMessage): boolean {
  return (message as { stopBeforeSubmit?: unknown }).stopBeforeSubmit === true;
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
