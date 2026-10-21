import { useCallback, useEffect, useState } from "react";

import { QUEUE_ACTION } from "../agent-queue/actions";
import { EMPTY_QUEUE, queueFromStored, type QueueState } from "../agent-queue/model";
import { AGENT_QUEUE_STORAGE_KEY, readQueue } from "../agent-queue/store";
import { MSG } from "../types";

import { sendMessage } from "./runtime";

export type QueueReply = {
  ok?: boolean;
  error?: string;
  added?: number;
  duplicates?: number;
  invalid?: number;
  overflow?: number;
};

/** The Agent tab's queue, kept in step with local storage, and the commands the service worker takes. */
export function useAgentQueue() {
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE);

  useEffect(() => {
    let alive = true;
    void readQueue().then((stored) => {
      if (alive) setQueue(stored);
    });
    const onChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
      changes,
      area,
    ) => {
      if (area === "local" && changes[AGENT_QUEUE_STORAGE_KEY]) {
        setQueue(queueFromStored(changes[AGENT_QUEUE_STORAGE_KEY].newValue));
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const send = useCallback(
    (action: string, rest: Record<string, unknown> = {}) =>
      sendMessage<QueueReply>({ type: MSG.AGENT_QUEUE, action, ...rest }),
    [],
  );

  return {
    queue,
    add: (text: string) => send(QUEUE_ACTION.add, { text }),
    start: () => send(QUEUE_ACTION.start),
    pause: () => send(QUEUE_ACTION.pause),
    skip: (id: string) => send(QUEUE_ACTION.skip, { id }),
    remove: (id: string) => send(QUEUE_ACTION.remove, { id }),
    clearFinished: () => send(QUEUE_ACTION.clearFinished),
    setCloseDone: (value: boolean) => send(QUEUE_ACTION.closeDone, { value }),
  };
}
