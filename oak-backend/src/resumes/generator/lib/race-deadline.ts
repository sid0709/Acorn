/** Finish when `work` resolves, or when `timeoutMs` / parent abort wins. */
export async function raceDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent: AbortSignal,
): Promise<T> {
  const jobAbort = new AbortController();
  const timedOut = Object.assign(
    new Error(
      `Résumé generation timed out after ${Math.round(timeoutMs / 1000)}s`,
    ),
    { name: 'TimeoutError' },
  );
  const timer = setTimeout(() => jobAbort.abort(timedOut), timeoutMs);
  const onParent = () => jobAbort.abort(parent.reason);
  if (parent.aborted) onParent();
  else parent.addEventListener('abort', onParent, { once: true });

  const deadline = new Promise<never>((_, reject) => {
    const fail = () => {
      const reason = jobAbort.signal.reason;
      reject(
        reason instanceof Error
          ? reason
          : Object.assign(new Error('Resume generation cancelled'), {
              name: 'AbortError',
            }),
      );
    };
    if (jobAbort.signal.aborted) fail();
    else jobAbort.signal.addEventListener('abort', fail, { once: true });
  });
  void deadline.catch(() => undefined);

  try {
    return await Promise.race([work(jobAbort.signal), deadline]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', onParent);
    if (!jobAbort.signal.aborted) jobAbort.abort();
  }
}
