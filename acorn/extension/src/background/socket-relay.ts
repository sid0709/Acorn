import { MSG, SOCKET_EVENT } from "../types";

import { recordPushedUsage } from "./tab-usage-store";

import type { Socket } from "socket.io-client";

export function bindSocketRelay(socket: Socket): void {
  socket.on(SOCKET_EVENT.aiUsageRecorded, (payload: unknown) => {
    void recordPushedUsage(payload).catch(() => undefined);
  });

  // The Support tab applies a report's change as it arrives; nothing is open when it is closed.
  for (const event of [SOCKET_EVENT.supportMessage, SOCKET_EVENT.supportClaim]) {
    socket.on(event, (payload: unknown) => {
      void chrome.runtime
        .sendMessage({ type: MSG.SUPPORT_CLAIMS_CHANGED, payload })
        .catch(() => undefined);
    });
  }
}
