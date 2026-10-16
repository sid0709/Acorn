/**
 * The person's answer to a question an agent Run asks (which résumé to send when no job
 * description was found). The Run waits here, on every tab it has claimed, and the sidebar's
 * answer message resolves it from whichever of those tabs is focused.
 */

const waiting = new Map<number, (answer: string) => void>();

/** Waits for the answer on any of these tabs. Rejects when the signal aborts (Stop). */
export function awaitRunAnswer(tabIds: Iterable<number>, signal: AbortSignal): Promise<string> {
  const tabs = [...tabIds];
  return new Promise<string>((resolve, reject) => {
    const settle = () => {
      for (const id of tabs) waiting.delete(id);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      settle();
      reject(new Error("stopped"));
    };
    if (signal.aborted) return onAbort();
    for (const id of tabs) {
      waiting.set(id, (answer) => {
        settle();
        resolve(answer);
      });
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Gives the person's answer to the Run waiting on this tab. False when none is. */
export function answerRunOnTab(tabId: number, answer: string): boolean {
  const resolve = waiting.get(tabId);
  if (!resolve) return false;
  resolve(answer);
  return true;
}
