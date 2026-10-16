import { MSG } from "../types";

import { sinkTrace } from "./debug-trace-sink";
import {
  handleAuthSignIn,
  handleAuthSignOut,
  handleAuthStatus,
  handleReconnectSocket,
  handleSocketStatus,
} from "./messages/auth";
import { handleStartJobWork } from "./messages/generate";
import { handleAnswerRun, handleStartRun, handleStopRun } from "./messages/run";
import { handleSelectionQa } from "./messages/selection-qa";
import { handleSubmitSupportClaim } from "./messages/support-claim";
import { handleSupportHandoff } from "./messages/support-session";
import { handleGetTabJob, handleOpenWorkerJob } from "./messages/worker-jobs";
import { refreshTabUsage } from "./tab-usage-store";

import type { TraceEntry } from "../debug-trace";
import type { RuntimeMessage, SendResponse } from "./messages/shared";

/** Sends each sidebar/content message to its handler. Returns true to keep `sendResponse` open. */
export function routeMessage(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
) {
  if (message.type === MSG.DEBUG_TRACE) {
    const entry = (message as unknown as { entry: TraceEntry }).entry;
    sinkTrace({ ...entry, frameId: sender.frameId, tabId: sender.tab?.id });
    return false;
  }

  if (message.type === MSG.SOCKET_STATUS) {
    handleSocketStatus(sendResponse);
    return true;
  }

  if (message.type === MSG.AUTH_STATUS) {
    handleAuthStatus(sendResponse);
    return true;
  }

  if (message.type === MSG.AUTH_SIGNIN) {
    handleAuthSignIn(message, sendResponse);
    return true;
  }

  if (message.type === MSG.AUTH_SIGNOUT) {
    handleAuthSignOut(sendResponse);
    return true;
  }

  if (message.type === MSG.OPEN_WORKER_JOB) {
    handleOpenWorkerJob(message, sender, sendResponse);
    return true;
  }

  if (message.type === MSG.GET_TAB_JOB) {
    handleGetTabJob(message, sender, sendResponse);
    return true;
  }

  if (message.type === MSG.SELECTION_QA) {
    handleSelectionQa(message, sender, sendResponse);
    return true;
  }

  if (message.type === MSG.START_JOB_GENERATE || message.type === MSG.START_JOB_RECOMMEND) {
    handleStartJobWork(message, sender, sendResponse);
    return true;
  }

  if (message.type === "acorn:reconnect-socket") {
    handleReconnectSocket(sendResponse);
    return true;
  }

  if (message.type === MSG.START_RUN) {
    handleStartRun(message, sender, sendResponse);
    return true;
  }

  if (message.type === MSG.ANSWER_RUN) {
    handleAnswerRun(message, sender, sendResponse);
    return false;
  }

  if (message.type === MSG.STOP_RUN) {
    handleStopRun(message, sender, sendResponse);
    return false;
  }

  if (message.type === MSG.SUPPORT_HANDOFF) {
    handleSupportHandoff(message, sender, sendResponse);
    return true;
  }

  if (message.type === MSG.SUBMIT_SUPPORT_CLAIM) {
    void handleSubmitSupportClaim(message, sender).then(sendResponse);
    return true;
  }

  if (message.type === MSG.REFRESH_TAB_USAGE) {
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false, error: "tabId is required" });
      return false;
    }
    refreshTabUsage(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
    return true;
  }
}
