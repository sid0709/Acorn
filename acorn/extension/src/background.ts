import {
  isAcornSocketConnected,
  reconnectAcornSocketNow,
  scheduleConnectAcornSocket,
} from "./acorn-socket";
import { rekeyKeptRun } from "./agent/kept-run";
import { bindAutoFocusSetting } from "./background/auto-focus";
import { bindRunTabGrouping } from "./background/run-group";
import { routeMessage } from "./background/message-router";
import { endKeptRunOfTab } from "./background/messages/run";
import { connectSocket, sidebarPorts, socketHandlers } from "./background/socket-connection";
import {
  KEEP_ALIVE_ALARM,
  WORK_KEEP_ALIVE_ALARM,
  anyTabWorking,
  pipelineRunningTabIds,
  runTabIds,
} from "./background/work-state";
import { bindContentScriptInjection, injectIntoOpenTabs } from "./inject-content";
import {
  LOG_KIND,
  LOG_LEVEL,
  clearTabLog,
  dropClosedTabLogs,
  dropLegacySessionLogs,
  flushTabLogs,
  logTab,
  moveTabLog,
  tabsWithRunContext,
} from "./tab-log-session";
import { clearTabPipeline, rekeyTabPipeline } from "./tab-pipeline-session";
import { rekeyUsageTab } from "./tab-usage-key";
import { MSG, ACORN_SIDEBAR_PORT } from "./types";

/**
 * A failure nobody caught lands in the log of every tab a run is on, so it shows
 * beside the run it hit instead of only in the service worker's console.
 */
function logUncaught(kind: string, reason: unknown): void {
  const message =
    reason instanceof Error
      ? { message: reason.message, stack: reason.stack }
      : { message: String(reason) };
  for (const tabId of tabsWithRunContext()) {
    logTab(tabId, LOG_KIND.error, `Uncaught ${kind} in the service worker`, () => message, {
      level: LOG_LEVEL.error,
    });
  }
}
self.addEventListener("unhandledrejection", (event) => logUncaught("rejection", event.reason));
self.addEventListener("error", (event) => logUncaught("error", event.error ?? event.message));
// Entries still waiting for their write go out before the worker is suspended.
chrome.runtime.onSuspend.addListener(() => void flushTabLogs());

function enableSidePanelOnActionClick(): void {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
}

void chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM) {
    if (sidebarPorts.size > 0) void chrome.runtime.getPlatformInfo();
    if (!isAcornSocketConnected()) void connectSocket().catch(() => undefined);
  }
  if (alarm.name === WORK_KEEP_ALIVE_ALARM) {
    if (anyTabWorking()) void chrome.runtime.getPlatformInfo();
    else void chrome.alarms.clear(WORK_KEEP_ALIVE_ALARM);
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== ACORN_SIDEBAR_PORT) return;
  sidebarPorts.add(port);
  try {
    port.postMessage({
      type: MSG.SOCKET_STATUS,
      connected: isAcornSocketConnected(),
    });
  } catch {
    sidebarPorts.delete(port);
    return;
  }
  void connectSocket().catch(() => undefined);
  port.onDisconnect.addListener(() => {
    sidebarPorts.delete(port);
  });
});

void connectSocket().catch(() => undefined);
// Back online: dial now instead of waiting out socket.io's backoff.
self.addEventListener("online", () => reconnectAcornSocketNow(socketHandlers));
enableSidePanelOnActionClick();
bindContentScriptInjection();
bindAutoFocusSetting();
bindRunTabGrouping();
void injectIntoOpenTabs();
// Logs of tabs a past browser session closed with, and the log's old session-storage copy.
void chrome.tabs
  .query({})
  .then((open) => dropClosedTabLogs(open.flatMap((tab) => (tab.id == null ? [] : [tab.id]))))
  .catch(() => undefined);
void dropLegacySessionLogs().catch(() => undefined);
chrome.runtime.onInstalled.addListener(enableSidePanelOnActionClick);

chrome.tabs.onRemoved.addListener((tabId) => {
  void endKeptRunOfTab(tabId);
  void clearTabPipeline(tabId);
  void clearTabLog(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  if (pipelineRunningTabIds.delete(removedTabId)) {
    pipelineRunningTabIds.add(addedTabId);
  }
  if (runTabIds.delete(removedTabId)) {
    runTabIds.add(addedTabId);
  }
  void moveTabLog(removedTabId, addedTabId).catch(() => undefined);
  void rekeyUsageTab(removedTabId, addedTabId);
  void rekeyTabPipeline(removedTabId, addedTabId);
  void rekeyKeptRun(removedTabId, addedTabId);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.acornApiUrl || changes.acornSession) {
    scheduleConnectAcornSocket(socketHandlers);
  }
});

chrome.runtime.onMessage.addListener(routeMessage);
