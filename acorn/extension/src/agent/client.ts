/**
 * The agent server's HTTP routes. The extension sends each screenshot and gets the next
 * actions back; the server holds the run's memory.
 */

import {
  AGENT_ERROR_CODE,
  AGENT_HANDLER_MS_HEADER,
  AGENT_KEY_HEADER,
  AGENT_ROUTES,
  AGENT_SERVER_TIME_HEADER,
  AGENT_SERVER_TIMING_HEADER,
  type AgentContinued,
  type AgentMemory,
  type AgentErrorBody,
  type AgentObservation,
  type AgentStart,
  type AgentStarted,
  type AgentStep,
  type AgentVetTarget,
  type AgentVetVerdict,
} from "@acorn/shared/agent-contract";

import type { HttpTiming } from "./timing";
import type { ResumeFile } from "./upload";

/** A step waits this long for the server: its model call retries, and may be asked to repair its answer. */
export const STEP_TIMEOUT_MS = 6 * 60_000;
/** Opening a run, ending one, and the health check are quick. */
export const QUICK_TIMEOUT_MS = 20_000;

/** A failed call, with the server's stable code (or ours, when the server never answered). */
export class AgentApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "AgentApiError";
  }
}

/** The codes of failures worth asking the server again about: the model was busy or briefly down. */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  AGENT_ERROR_CODE.rateLimited,
  AGENT_ERROR_CODE.modelError,
  AGENT_ERROR_CODE.network,
  AGENT_ERROR_CODE.badRequest,
]);

/** Whether the same step may be sent again. */
export function isRetryable(err: unknown): boolean {
  return (
    err instanceof AgentApiError && (RETRYABLE_CODES.has(err.code) || err.code === "unreachable")
  );
}

type CallOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  key?: string;
  /** The person's Acorn session, sent as a bearer token. */
  token?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  /** Told how long the request took and where, whether or not it succeeded. */
  onTiming?: (timing: HttpTiming) => void;
};

/** A request's answer, its body already read (so the time to read it is part of the timing). */
type Answer = { response: Response; body: ArrayBuffer };

const SESSION_ID_IN_PATH = /\/sessions\/[^/?]+/;
const encoder = new TextEncoder();

function parseJson<T>(answer: Answer): T {
  return JSON.parse(new TextDecoder().decode(answer.body)) as T;
}

function headerNumber(response: Response, name: string): number | undefined {
  const value = Number(response.headers.get(name));
  return response.headers.get(name) != null && Number.isFinite(value) ? value : undefined;
}

async function call(base: string, path: string, options: CallOptions): Promise<Answer> {
  const headers: Record<string, string> = {};
  const payload =
    options.body === undefined ? undefined : encoder.encode(JSON.stringify(options.body));
  if (payload) headers["Content-Type"] = "application/json";
  if (options.key) headers[AGENT_KEY_HEADER] = options.key;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const timing: HttpTiming = {
    method: options.method ?? "GET",
    route: path.replace(SESSION_ID_IN_PATH, "/sessions/:id"),
    status: 0,
    startedAt: Date.now(),
    ms: 0,
    headersMs: 0,
    bodyMs: 0,
    requestBytes: payload?.byteLength ?? 0,
    responseBytes: 0,
  };
  const report = (error?: string) => {
    timing.ms = Date.now() - timing.startedAt;
    if (error) timing.error = error;
    options.onTiming?.(timing);
  };
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: timing.method,
      headers,
      body: payload,
      signal,
    });
  } catch (err) {
    timing.headersMs = Date.now() - timing.startedAt;
    if (options.signal?.aborted) {
      report("aborted");
      throw err;
    }
    if (timeout.aborted) {
      report("timeout");
      throw new AgentApiError("The agent server took too long to answer.", "timeout");
    }
    report("unreachable");
    throw new AgentApiError(
      `Can't reach the Acorn agent at ${base}. Start it on this computer, then run again.`,
      "unreachable",
    );
  }
  const headersAt = Date.now();
  timing.status = response.status;
  timing.headersMs = headersAt - timing.startedAt;
  let body: ArrayBuffer;
  try {
    body = await response.arrayBuffer();
  } catch (err) {
    timing.bodyMs = Date.now() - headersAt;
    report(timeout.aborted ? "timeout" : "body");
    if (options.signal?.aborted) throw err;
    throw new AgentApiError(
      timeout.aborted
        ? "The agent server took too long to answer."
        : "The agent server's answer was cut off.",
      timeout.aborted ? "timeout" : "unreachable",
    );
  }
  timing.bodyMs = Date.now() - headersAt;
  timing.responseBytes = body.byteLength;
  const serverMs = headerNumber(response, AGENT_HANDLER_MS_HEADER);
  const serverTime = headerNumber(response, AGENT_SERVER_TIME_HEADER);
  if (serverMs != null) {
    timing.serverMs = serverMs;
    timing.networkMs = Date.now() - timing.startedAt - serverMs;
  }
  const serverTiming = response.headers.get(AGENT_SERVER_TIMING_HEADER);
  if (serverTiming) timing.serverTiming = serverTiming;
  if (serverTime != null) timing.clockSkewMs = serverTime - (timing.startedAt + timing.headersMs);
  if (response.ok) {
    report();
    return { response, body };
  }
  let errorBody: Partial<AgentErrorBody> = {};
  try {
    errorBody = parseJson<Partial<AgentErrorBody>>({ response, body });
  } catch {
    // The server sent no JSON: the status says what it can.
  }
  report(errorBody.code || "error");
  throw new AgentApiError(
    errorBody.error || `The agent server answered ${response.status}.`,
    errorBody.code || "error",
    response.status,
  );
}

/**
 * Opens a run. `token` is the person's Acorn session: the agent reads their profile and Library
 * from acorn-backend with it, and keeps it only for the run. A development agent that reads
 * local files ignores it.
 */
export async function startSession(
  base: string,
  start: AgentStart,
  key?: string,
  token?: string,
  onTiming?: CallOptions["onTiming"],
): Promise<AgentStarted> {
  const response = await call(base, AGENT_ROUTES.sessions, {
    method: "POST",
    body: start,
    key,
    token,
    timeoutMs: QUICK_TIMEOUT_MS,
    onTiming,
  });
  return parseJson<AgentStarted>(response);
}

/**
 * Takes a stopped run back up: the server keeps its memory, history and cost, and tells the
 * model the person pressed Continue. A session the server no longer holds answers `no_session`.
 */
export async function continueSession(
  base: string,
  sessionId: string,
  onTiming?: CallOptions["onTiming"],
): Promise<AgentContinued> {
  const response = await call(base, AGENT_ROUTES.continue(sessionId), {
    method: "POST",
    timeoutMs: QUICK_TIMEOUT_MS,
    onTiming,
  });
  return parseJson<AgentContinued>(response);
}

/**
 * What a run knows, to keep when it stops so Continue can go on from it even if the server forgets
 * the session. A failure here changes nothing for the person, so it is not raised: the run is
 * kept without it.
 */
export async function fetchMemory(
  base: string,
  sessionId: string,
  onTiming?: CallOptions["onTiming"],
): Promise<AgentMemory | undefined> {
  try {
    const response = await call(base, AGENT_ROUTES.memory(sessionId), {
      timeoutMs: QUICK_TIMEOUT_MS,
      onTiming,
    });
    return parseJson<AgentMemory>(response);
  } catch {
    return undefined;
  }
}

export async function sendStep(
  base: string,
  sessionId: string,
  observation: AgentObservation,
  signal: AbortSignal,
  onTiming?: CallOptions["onTiming"],
): Promise<AgentStep> {
  const response = await call(base, AGENT_ROUTES.step(sessionId), {
    method: "POST",
    body: observation,
    signal,
    timeoutMs: STEP_TIMEOUT_MS,
    onTiming,
  });
  return parseJson<AgentStep>(response);
}

/** Asks whether a control about to be clicked, or a window a click opened, is an online file source. */
export async function vetTarget(
  base: string,
  sessionId: string,
  target: AgentVetTarget,
  signal: AbortSignal,
  onTiming?: CallOptions["onTiming"],
): Promise<AgentVetVerdict> {
  const response = await call(base, AGENT_ROUTES.vet(sessionId), {
    method: "POST",
    body: target,
    signal,
    timeoutMs: QUICK_TIMEOUT_MS,
    onTiming,
  });
  return parseJson<AgentVetVerdict>(response);
}

/** Ends a run's session. A failure here changes nothing for the person, so it is not raised. */
export async function endSession(
  base: string,
  sessionId: string,
  onTiming?: CallOptions["onTiming"],
): Promise<void> {
  await call(base, AGENT_ROUTES.session(sessionId), {
    method: "DELETE",
    timeoutMs: QUICK_TIMEOUT_MS,
    onTiming,
  }).catch(() => undefined);
}

export async function fetchResumeFile(
  base: string,
  sessionId: string,
  resumeId: string,
  fileName: string,
  signal: AbortSignal,
  toBase64: (bytes: ArrayBuffer) => string,
  onTiming?: CallOptions["onTiming"],
): Promise<ResumeFile> {
  const { response, body } = await call(base, AGENT_ROUTES.resume(sessionId, resumeId), {
    signal,
    timeoutMs: QUICK_TIMEOUT_MS,
    onTiming,
  });
  const encoding = Date.now();
  const base64 = toBase64(body);
  return {
    fileName: response.headers.get("X-File-Name") || fileName,
    contentType: response.headers.get("Content-Type") || "application/octet-stream",
    base64,
    encodeMs: Date.now() - encoding,
  };
}
