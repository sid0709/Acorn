/**
 * Every call to the Acorn backend, written to the tab's log: what was sent, what
 * came back, the status, how long it took, and a call that never got an answer
 * (offline, DNS, a timeout) as an entry of its own. A run can be debugged from the
 * log alone because the decision models' inputs and answers are here, not only on
 * the server. Nothing is sent anywhere by this.
 */

import { LOG_KIND, LOG_LEVEL, logTab } from "../../tab-log-session";

/** Keys whose values never reach the log, at any depth. */
const SECRET_KEYS = new Set([
  "password",
  "accountpassword",
  "verificationcode",
  "authorization",
  "apikey",
  "token",
  "openrouterapikey",
  "cookie",
]);

const HIDDEN = "(hidden)";

/** A copy of `value` with every secret key's value replaced; `hide` names more keys to hide. */
export function redactForLog(value: unknown, hide: readonly string[] = []): unknown {
  const extra = new Set(hide.map((key) => key.toLowerCase()));
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node).map(([key, child]) => {
          const lower = key.toLowerCase();
          return [key, SECRET_KEYS.has(lower) || extra.has(lower) ? HIDDEN : walk(child)];
        }),
      );
    }
    return node;
  };
  return walk(value);
}

export type ApiLogOptions = {
  /** Keys to hide in this call's request and answer, beyond the ones always hidden. */
  hide?: readonly string[];
  /** The answer is large and uninteresting (a file): log its status and size only. */
  summaryOnly?: boolean;
  /** Trim a request the log holds elsewhere (a tree has an entry of its own). */
  shapeRequest?: (request: unknown) => unknown;
  /** Trim an answer the log holds elsewhere (a plan has an entry of its own). */
  shapeResponse?: (body: unknown) => unknown;
};

let sequence = 0;

function parseBody(body: unknown): unknown {
  if (typeof body !== "string") return body == null ? undefined : "(not text)";
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

/** Why a call that got no answer failed, in words a person reading the log can use. */
export function describeNetworkError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return `The request took too long and was stopped (${text})`;
  }
  if (/failed to fetch|networkerror|load failed/i.test(text)) {
    return `Could not reach the Acorn server (${text})`;
  }
  return text;
}

/**
 * `fetch` with the call written to the tab's log. The response is returned
 * untouched (its body is read from a clone), and a failure to answer is rethrown
 * after it is logged.
 */
export async function loggedFetch(
  tabId: number | null | undefined,
  name: string,
  input: string,
  init: RequestInit & { priority?: string } = {},
  options: ApiLogOptions = {},
): Promise<Response> {
  if (tabId == null) return fetch(input, init);
  sequence += 1;
  const group = `${name}#${sequence}`;
  const started = Date.now();
  const method = init.method ?? "GET";
  logTab(
    tabId,
    LOG_KIND.api,
    `→ ${method} ${name}`,
    () => {
      const request = redactForLog(parseBody(init.body), options.hide);
      return (options.shapeRequest ? options.shapeRequest(request) : request) ?? "(no body)";
    },
    { group },
  );
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    const ms = Date.now() - started;
    logTab(
      tabId,
      LOG_KIND.error,
      `✕ ${name} · no answer · ${ms} ms`,
      () => ({ cause: describeNetworkError(err), raw: String(err) }),
      { group, ms, level: LOG_LEVEL.error },
    );
    throw err;
  }
  const ms = Date.now() - started;
  const level = res.ok || res.status === 304 ? LOG_LEVEL.info : LOG_LEVEL.warn;
  if (options.summaryOnly) {
    logTab(
      tabId,
      LOG_KIND.api,
      `← ${name} · ${res.status} · ${ms} ms`,
      () => ({
        status: res.status,
        etag: res.headers.get("ETag"),
        bytes: res.headers.get("Content-Length"),
      }),
      { group, ms, level },
    );
    return res;
  }
  const copy = res.clone();
  void copy
    .text()
    .then((text) => {
      let body: unknown = text;
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        // Not JSON: the text itself is the record.
      }
      logTab(
        tabId,
        LOG_KIND.api,
        `← ${name} · ${res.status} · ${ms} ms`,
        () => {
          const answer = redactForLog(body, options.hide);
          return {
            status: res.status,
            body: options.shapeResponse ? options.shapeResponse(answer) : answer,
          };
        },
        { group, ms, level },
      );
    })
    .catch(() => undefined);
  return res;
}
