import { withStorageLock } from "../storage-lock";

import { queueFromStored, type QueueState } from "./model";

/** The queue lives in local storage: the side panel reads it, the service worker writes it. */
export const AGENT_QUEUE_STORAGE_KEY = "acornAgentQueue";

export async function readQueue(): Promise<QueueState> {
  const stored = await chrome.storage.local.get(AGENT_QUEUE_STORAGE_KEY);
  return queueFromStored(stored[AGENT_QUEUE_STORAGE_KEY]);
}

/** Changes the queue as one step: updates run in turn, each on what the one before left. */
export function updateQueue<T = void>(
  change: (state: QueueState) => { state: QueueState; result?: T },
): Promise<T | undefined> {
  return withStorageLock(AGENT_QUEUE_STORAGE_KEY, async () => {
    const { state, result } = change(await readQueue());
    await chrome.storage.local.set({ [AGENT_QUEUE_STORAGE_KEY]: state });
    return result;
  });
}
