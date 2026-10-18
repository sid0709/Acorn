/**
 * The agent server's HTTP routes. The extension sends each screenshot and gets the next
 * actions back; the server holds the run's memory.
 */

import {
  AGENT_ERROR_CODE,
  AGENT_KEY_HEADER,
  AGENT_ROUTES,
  type AgentContinued,
  type AgentMemory,
  type AgentErrorBody,
  type AgentAdvanceRequest,
  type AgentAdvanceResult,
  type AgentObservation,
  type AgentPrefillPlan,
  type AgentPrefillRequest,
  type AgentReviewRequest,
  type AgentReviewResult,
  type AgentStart,
  type AgentStarted,
  type AgentStep,
  type AgentVetTarget,
  type AgentVetVerdict,
} from "@acorn/shared/agent-contract";

import { PREFILL_TIMEOUT_MS } from "./prefill/settings";

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
};

async function call(base: string, path: string, options: CallOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.key) headers[AGENT_KEY_HEADER] = options.key;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
    });
  } catch (err) {
    if (options.signal?.aborted) throw err;
    if (timeout.aborted)
      throw new AgentApiError("The agent server took too long to answer.", "timeout");
    throw new AgentApiError(
      `Can't reach the Acorn agent at ${base}. Start it on this computer, then run again.`,
      "unreachable",
    );
  }
  if (response.ok) return response;
  let body: Partial<AgentErrorBody> = {};
  try {
    body = (await response.json()) as Partial<AgentErrorBody>;
  } catch {
    // The server sent no JSON: the status says what it can.
  }
  throw new AgentApiError(
    body.error || `The agent server answered ${response.status}.`,
    body.code || "error",
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
): Promise<AgentStarted> {
  const response = await call(base, AGENT_ROUTES.sessions, {
    method: "POST",
    body: start,
    key,
    token,
    timeoutMs: QUICK_TIMEOUT_MS,
  });
  return (await response.json()) as AgentStarted;
}

/**
 * Takes a stopped run back up: the server keeps its memory, history and cost, and tells the
 * model the person pressed Continue. A session the server no longer holds answers `no_session`.
 */
export async function continueSession(base: string, sessionId: string): Promise<AgentContinued> {
  const response = await call(base, AGENT_ROUTES.continue(sessionId), {
    method: "POST",
    timeoutMs: QUICK_TIMEOUT_MS,
  });
  return (await response.json()) as AgentContinued;
}

/**
 * What a run knows, to keep when it stops so Continue can go on from it even if the server forgets
 * the session. A failure here changes nothing for the person, so it is not raised: the run is
 * kept without it.
 */
export async function fetchMemory(
  base: string,
  sessionId: string,
): Promise<AgentMemory | undefined> {
  try {
    const response = await call(base, AGENT_ROUTES.memory(sessionId), {
      timeoutMs: QUICK_TIMEOUT_MS,
    });
    return (await response.json()) as AgentMemory;
  } catch {
    return undefined;
  }
}

export async function sendStep(
  base: string,
  sessionId: string,
  observation: AgentObservation,
  signal: AbortSignal,
): Promise<AgentStep> {
  const response = await call(base, AGENT_ROUTES.step(sessionId), {
    method: "POST",
    body: observation,
    signal,
    timeoutMs: STEP_TIMEOUT_MS,
  });
  return (await response.json()) as AgentStep;
}

/**
 * Asks the server to answer the page's plain fields in one model call that reads text only. The
 * answer is what to type; nothing is done to the page here.
 */
export async function requestPrefill(
  base: string,
  sessionId: string,
  request: AgentPrefillRequest,
  signal: AbortSignal,
): Promise<AgentPrefillPlan> {
  const response = await call(base, AGENT_ROUTES.prefill(sessionId), {
    method: "POST",
    body: request,
    signal,
    timeoutMs: PREFILL_TIMEOUT_MS,
  });
  return (await response.json()) as AgentPrefillPlan;
}

/** Reviews the page after the first draft: what is left, whether the screen is clean, whether only the person can go on. */
export async function requestReview(
  base: string,
  sessionId: string,
  request: AgentReviewRequest,
  signal: AbortSignal,
): Promise<AgentReviewResult> {
  const response = await call(base, AGENT_ROUTES.review(sessionId), {
    method: "POST",
    body: request,
    signal,
    timeoutMs: QUICK_TIMEOUT_MS,
  });
  return (await response.json()) as AgentReviewResult;
}

/** Asks which control of a clean page continues the application. */
export async function requestAdvance(
  base: string,
  sessionId: string,
  request: AgentAdvanceRequest,
  signal: AbortSignal,
): Promise<AgentAdvanceResult> {
  const response = await call(base, AGENT_ROUTES.advance(sessionId), {
    method: "POST",
    body: request,
    signal,
    timeoutMs: QUICK_TIMEOUT_MS,
  });
  return (await response.json()) as AgentAdvanceResult;
}

/** Asks whether a control about to be clicked, or a window a click opened, is an online file source. */
export async function vetTarget(
  base: string,
  sessionId: string,
  target: AgentVetTarget,
  signal: AbortSignal,
): Promise<AgentVetVerdict> {
  const response = await call(base, AGENT_ROUTES.vet(sessionId), {
    method: "POST",
    body: target,
    signal,
    timeoutMs: QUICK_TIMEOUT_MS,
  });
  return (await response.json()) as AgentVetVerdict;
}

/** Ends a run's session. A failure here changes nothing for the person, so it is not raised. */
export async function endSession(base: string, sessionId: string): Promise<void> {
  await call(base, AGENT_ROUTES.session(sessionId), {
    method: "DELETE",
    timeoutMs: QUICK_TIMEOUT_MS,
  }).catch(() => undefined);
}

export async function fetchResumeFile(
  base: string,
  sessionId: string,
  resumeId: string,
  fileName: string,
  signal: AbortSignal,
  toBase64: (bytes: ArrayBuffer) => string,
): Promise<ResumeFile> {
  const response = await call(base, AGENT_ROUTES.resume(sessionId, resumeId), {
    signal,
    timeoutMs: QUICK_TIMEOUT_MS,
  });
  return {
    fileName: response.headers.get("X-File-Name") || fileName,
    contentType: response.headers.get("Content-Type") || "application/octet-stream",
    base64: toBase64(await response.arrayBuffer()),
  };
}
