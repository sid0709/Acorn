/** Long-lived side-panel port. Keeps the MV3 worker (and `/acorn/socket.io` socket) alive. */
export const ACORN_SIDEBAR_PORT = "acorn-sidebar";

/** Socket.IO events the server sends this extension (same strings as acornapi/gateway). */
export const SOCKET_EVENT = {
  /** One AI call was recorded: `{ tab, entry }`, tab being the usage key it belongs to. */
  aiUsageRecorded: "ai-usage:recorded",
  /** A new message, from either side, on one of this account's reports: `{ claim, message }`. */
  supportMessage: "support:message",
  /** Support opened or closed one of this account's reports: `{ claim }`. */
  supportClaim: "support:claim",
} as const;

export const MSG = {
  /** Sidebar → service worker: reconcile one tab's AI usage with the server's list. */
  REFRESH_TAB_USAGE: "acorn:refresh-tab-usage",
  /** Sidebar → service worker: full-page screenshot of the active tab, filed with notes as a support claim. */
  SUBMIT_SUPPORT_CLAIM: "acorn:submit-support-claim",
  /** Service worker → sidebar: a report changed on the server; `payload` is the socket event's. */
  SUPPORT_CLAIMS_CHANGED: "acorn:support-claims-changed",
  /** Content script on the Acorn site → service worker: a support sign-in code to redeem. */
  SUPPORT_HANDOFF: "acorn:support-handoff-relay",
  /** Run: the agent fills and advances until the application is done. */
  START_RUN: "acorn:start-run",
  /** Sidebar → service worker: stop the Run working on this tab, at once. */
  STOP_RUN: "acorn:stop-run",
  /** Sidebar → service worker: the person's answer to the question an agent Run is waiting on. */
  ANSWER_RUN: "acorn:answer-run",
  PIPELINE_PROGRESS: "acorn:pipeline-progress",
  SOCKET_STATUS: "acorn:socket-status",
  OPERATOR_NOTICE: "acorn:operator-notice",
  AUTH_STATUS: "acorn:auth-status",
  AUTH_SIGNIN: "acorn:auth-signin",
  AUTH_SIGNOUT: "acorn:auth-signout",
  SELECTION_QA: "acorn:selection-qa",
  /** Debug builds only: a page trace event relayed to the backend debug run. */
  DEBUG_TRACE: "acorn:debug-trace",
} as const;

export type AcornNoticeKind = "error" | "success" | "info";

export type AcornNoticePayload = {
  /** Notices sharing an id replace each other on screen instead of stacking. */
  id?: string;
  kind: AcornNoticeKind;
  title: string;
  detail?: string;
  /**
   * When set, the toast belongs to that Chrome tab: it shows only while the tab
   * is focused, and leaves when the person switches to another tab.
   * Omit it for account and connection notices, which stay up in every tab.
   */
  tabId?: number;
};

export type SelectionQaResponse = {
  ok: boolean;
  answer?: string;
  error?: string;
};
