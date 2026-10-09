import { MSG } from "../types";

import { sinkTrace } from "./debug-trace-sink";
import {
  handleAuthSignIn,
  handleAuthSignOut,
  handleAuthStatus,
  handleReconnectSocket,
  handleSocketStatus,
} from "./messages/auth";
import {
  handleFocusCustomTab,
  handleForgetCustomTab,
  handleRememberCustomTab,
} from "./messages/custom-tabs";
import { handleEstimateOption } from "./messages/estimate-option";
import {
  handleStartCustomGenerate,
  handleStartCustomRecommend,
  handleStartJobWork,
} from "./messages/generate";
import { handleMatchOption } from "./messages/match-option";
import { handleFetchDom, handleStartPipeline } from "./messages/pipeline";
import { handleStartRun, handleStopRun } from "./messages/run";
import { handleSelectionQa } from "./messages/selection-qa";
import { handleSubmitSupportClaim } from "./messages/support-claim";
import { handleSupportHandoff } from "./messages/support-session";
import { handleGetTabJob, handleMarkJobApplied, handleOpenWorkerJob } from "./messages/worker-jobs";
import { refreshTabUsage } from "./tab-usage-store";

import type { TraceEntry } from "../debug-trace";
import type { RuntimeMessage, SendResponse } from "./messages/shared";

/** The longest page delay the service worker times; longer waits are the page's own. */
const PAGE_DELAY_MAX_MS = 60_000;

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

  if (message.type === MSG.PAGE_DELAY) {
    const ms = Math.min(
      Math.max(0, Number((message as { ms?: unknown }).ms) || 0),
      PAGE_DELAY_MAX_MS,
    );
    setTimeout(() => sendResponse({ ok: true }), ms);
    return true;
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

  if (message.type === MSG.MARK_JOB_APPLIED) {
    handleMarkJobApplied(message, sendResponse);
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

  if (message.type === MSG.REMEMBER_CUSTOM_TAB) {
    handleRememberCustomTab(message, sender, sendResponse);
    return true;
  }

  if (message.type === MSG.FORGET_CUSTOM_TAB) {
    handleForgetCustomTab(message, sender, sendResponse);
    return true;
  }

  if (message.type === MSG.FOCUS_CUSTOM_TAB) {
    handleFocusCustomTab(message, sender, sendResponse);
    return true;
  }

  if (message.type === MSG.START_CUSTOM_GENERATE) {
    handleStartCustomGenerate(message, sender, sendResponse);
    return true;
  }

  if (message.type === MSG.START_CUSTOM_RECOMMEND) {
    handleStartCustomRecommend(message, sender, sendResponse);
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

  if (message.type === MSG.STOP_RUN) {
    handleStopRun(message, sender, sendResponse);
    return false;
  }

  if (message.type === MSG.START_PIPELINE) {
    handleStartPipeline(message, sender, sendResponse);
    return true;
  }

  if (message.type === MSG.MATCH_OPTION) {
    handleMatchOption(message, sender, sendResponse);
    return true;
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

  if (message.type === MSG.ESTIMATE_OPTION) {
    handleEstimateOption(message, sender, sendResponse);
    return true;
  }

  if (message.type === MSG.FETCH_DOM || message.type === MSG.FETCH_AND_EMIT_DOM) {
    handleFetchDom(message, sender, sendResponse);
    return true;
  }
}
