const DEFAULT_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error('IMAP operation cancelled'), {
        name: 'AbortError',
      });
}

export function throwIfImapAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

export function formatImapError(error: unknown): string {
  if (error == null) return 'Unknown IMAP error';
  if (typeof error === 'string') return error;

  const err = error as {
    message?: string;
    responseStatus?: string;
    responseText?: string;
  };
  const base = String(err.message || error).trim() || 'IMAP error';
  const status = String(err.responseStatus || '')
    .trim()
    .toUpperCase();
  const text = String(err.responseText || '').trim();
  if (!status && !text) return base;
  const detail = [status, text].filter(Boolean).join(' ');
  if (base.includes(detail)) return base;
  return `${base}: ${detail}`;
}

export function isRetryableImapError(
  error: unknown,
  signal?: AbortSignal,
): boolean {
  if (!error || signal?.aborted) return false;
  const err = error as {
    name?: string;
    message?: string;
    responseStatus?: string;
  };
  if (err.name === 'AbortError') return false;

  const message = String(err.message || error);
  if (/^Command failed$/i.test(message.trim())) return true;
  if (/Command failed:/i.test(message)) return true;
  if (/IMAP connection pool exhausted/i.test(message)) return true;
  if (
    /ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|socket|closed|disconnected|not available/i.test(
      message,
    )
  ) {
    return true;
  }
  const status = String(err.responseStatus || '').toUpperCase();
  if (status === 'NO' || status === 'BAD') return true;
  return false;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfImapAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(abortError(signal));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

export async function withImapRetry<T>(
  fn: () => Promise<T>,
  options: {
    signal?: AbortSignal;
    attempts?: number;
    baseDelayMs?: number;
  } = {},
): Promise<T> {
  const attempts = Math.max(1, Number(options.attempts) || DEFAULT_ATTEMPTS);
  const baseDelayMs = Math.max(
    50,
    Number(options.baseDelayMs) || BASE_DELAY_MS,
  );
  const signal = options.signal;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    throwIfImapAborted(signal);
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableImapError(error, signal) || attempt === attempts - 1) {
        const enriched = new Error(formatImapError(error)) as Error & {
          responseStatus?: string;
          responseText?: string;
          cause?: unknown;
        };
        const err = error as {
          name?: string;
          responseStatus?: string;
          responseText?: string;
        };
        enriched.name = err?.name || 'Error';
        if (err?.responseStatus) enriched.responseStatus = err.responseStatus;
        if (err?.responseText) enriched.responseText = err.responseText;
        enriched.cause = error;
        throw enriched;
      }
      await delay(baseDelayMs * 2 ** attempt, signal);
    }
  }

  throw new Error(formatImapError(lastError));
}
