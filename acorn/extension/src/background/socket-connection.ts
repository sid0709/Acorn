import {
  connectAcornSocket,
  getAcornSocket,
  isAcornSocketConnected,
  type AcornSocketHandlers,
} from "../acorn-socket";
import { queueTabPipeline } from "../tab-pipeline-session";
import { MSG } from "../types";

import { createConnectionNotice } from "./connection-notice";
import { bindSocketRelay } from "./socket-relay";

import type { PipelineProgress } from "@acorn/shared/pipeline-types";

export const sidebarPorts = new Set<chrome.runtime.Port>();
const connectionNotice = createConnectionNotice();

export function broadcastPipelineProgress(tabId: number, progress: PipelineProgress): void {
  getAcornSocket()?.emit("pipeline:progress", { tabId, progress });
  void queueTabPipeline(tabId, progress);
  chrome.runtime.sendMessage({ type: MSG.PIPELINE_PROGRESS, tabId, progress }, () => {
    void chrome.runtime.lastError;
  });
}

function pushSocketStatus(connected: boolean): void {
  const message = { type: MSG.SOCKET_STATUS, connected };
  for (const port of sidebarPorts) {
    try {
      port.postMessage(message);
    } catch {
      sidebarPorts.delete(port);
    }
  }
}

export const socketHandlers: AcornSocketHandlers = {
  bindEvents: bindSocketRelay,
  onConnected: () => {
    pushSocketStatus(true);
    connectionNotice.markConnected();
  },
  onDisconnected: () => {
    pushSocketStatus(false);
    connectionNotice.markDown(null);
  },
  onConnectError: (err) => {
    if (isAcornSocketConnected()) return;
    pushSocketStatus(false);
    connectionNotice.markDown(err);
  },
  onIdle: () => {
    pushSocketStatus(false);
    connectionNotice.reset();
  },
};

export function connectSocket(): Promise<void> {
  return connectAcornSocket(socketHandlers);
}
