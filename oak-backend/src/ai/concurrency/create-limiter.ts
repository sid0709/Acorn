/** In-process async concurrency limiters (FIFO; no 429 rejections). */

export type Limiter = {
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  readonly active: number;
  readonly pending: number;
};

export function createLimiter(concurrency: number): Limiter {
  const max = Math.max(1, concurrency);
  let active = 0;
  const waiters: Array<() => void> = [];

  function tryDrain() {
    while (active < max && waiters.length > 0) {
      active += 1;
      const resolve = waiters.shift();
      resolve?.();
    }
  }

  function acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (active < max) {
        active += 1;
        resolve();
      } else {
        waiters.push(resolve);
      }
    });
  }

  function release() {
    if (active <= 0) return;
    active -= 1;
    tryDrain();
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get pending() {
      return waiters.length;
    },
  };
}

export type FairLimiter = {
  run: <T>(
    key: string,
    fn: () => Promise<T>,
    opts?: { signal?: AbortSignal },
  ) => Promise<T>;
  readonly globalActive: number;
  readonly pending: number;
};

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error('Queued work cancelled'), { name: 'AbortError' });
}

/**
 * Fair limiter: waiters need both a global slot and a per-key slot.
 * Cross-key skip when the head is blocked; per-key FIFO preserved.
 */
export function createFairLimiter(opts: {
  globalConcurrency: number;
  perKeyConcurrency: number;
}): FairLimiter {
  const globalMax = Math.max(1, opts.globalConcurrency);
  const perKeyMax = Math.max(1, opts.perKeyConcurrency);
  let globalActive = 0;
  const perKeyActive = new Map<string, number>();
  type Waiter = {
    key: string;
    resolve: (release: () => void) => void;
    reject: (err: Error) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  };
  const waiters: Waiter[] = [];

  function keyCount(key: string) {
    return perKeyActive.get(key) ?? 0;
  }

  function canGrant(key: string) {
    return globalActive < globalMax && keyCount(key) < perKeyMax;
  }

  function grant(key: string) {
    globalActive += 1;
    perKeyActive.set(key, keyCount(key) + 1);
  }

  function revoke(key: string) {
    globalActive = Math.max(0, globalActive - 1);
    const next = keyCount(key) - 1;
    if (next <= 0) perKeyActive.delete(key);
    else perKeyActive.set(key, next);
  }

  function makeRelease(key: string) {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      revoke(key);
      tryDrain();
    };
  }

  function tryDrain() {
    const blockedKeys = new Set<string>();
    let i = 0;
    while (i < waiters.length && globalActive < globalMax) {
      const waiter = waiters[i];
      if (!waiter || blockedKeys.has(waiter.key)) {
        i += 1;
        continue;
      }
      if (!canGrant(waiter.key)) {
        blockedKeys.add(waiter.key);
        i += 1;
        continue;
      }
      waiters.splice(i, 1);
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }
      grant(waiter.key);
      waiter.resolve(makeRelease(waiter.key));
    }
  }

  function acquire(key: string, signal?: AbortSignal): Promise<() => void> {
    const normalizedKey = String(key ?? '');
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise((resolve, reject) => {
      if (waiters.length === 0 && canGrant(normalizedKey)) {
        grant(normalizedKey);
        resolve(makeRelease(normalizedKey));
        return;
      }
      const waiter: Waiter = {
        key: normalizedKey,
        resolve,
        reject,
        signal,
      };
      waiter.onAbort = () => {
        const index = waiters.indexOf(waiter);
        if (index < 0) return;
        waiters.splice(index, 1);
        reject(abortError(signal));
        tryDrain();
      };
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
      waiters.push(waiter);
      tryDrain();
    });
  }

  return {
    async run<T>(
      key: string,
      fn: () => Promise<T>,
      opts?: { signal?: AbortSignal },
    ): Promise<T> {
      const releaseSlot = await acquire(String(key ?? ''), opts?.signal);
      try {
        return await fn();
      } finally {
        releaseSlot();
      }
    },
    get globalActive() {
      return globalActive;
    },
    get pending() {
      return waiters.length;
    },
  };
}

/** Run `fn` over `items` with at most `concurrency` in flight. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const max = Math.max(1, concurrency);
  const results: R[] = [];
  results.length = items.length;
  let next = 0;

  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(max, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, size);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(items.slice(i, i + n));
  }
  return out;
}
