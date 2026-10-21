/** What the sidebar asks of the Agent queue (`MSG.AGENT_QUEUE`'s `action`). */
export const QUEUE_ACTION = {
  add: "add",
  start: "start",
  pause: "pause",
  skip: "skip",
  remove: "remove",
  clearFinished: "clear-finished",
  closeDone: "close-done",
} as const;
