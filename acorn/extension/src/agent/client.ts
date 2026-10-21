/**
 * The agent server's HTTP routes. The extension sends each screenshot and gets the next
 * actions back; the server holds the run's memory.
 *
 * Over the person's line, which may be slow, a request is made as light as it can be without
 * changing what the agent is given: bodies go gzipped when the server unpacks them, a picture the
 * server already holds goes as a reference to it (image-refs.ts), a picture still on its way is
 * waited for rather than sent again, and requests take turns on the line, the ones an action waits
 * on first (upload-lane.ts). What the server offers is learnt when the run starts (transport.ts).
 */

import {
  AGENT_ERROR_CODE,
  AGENT_GZIP_ENCODING,
  AGENT_HANDLER_MS_HEADER,
  AGENT_KEY_HEADER,
  AGENT_ROUTES,
  AGENT_SERVER_TIME_HEADER,
  AGENT_SERVER_TIMING_HEADER,
  type AgentBlobsUpload,
  type AgentContinued,
  type AgentMemory,
  type AgentErrorBody,
  type AgentObservation,
  type AgentStart,
  type AgentStarted,
  type AgentStep,
  type AgentVetTarget,
  type AgentLocate,
  type AgentLocated,
  type AgentAction,
  type AgentShotAnswer,
  type AgentShotUpload,
  type AgentVetVerdict,
} from "@acorn/shared/agent-contract";

import {
  imageHash,
  imageHashes,
  packImages,
  packableObservation,
  packableShot,
} from "./image-refs";
import {
  GZIP_MIN_BYTES,
  forgetTransport,
  gzipBytes,
  rememberTransport,
  transferAllowanceMs,
  transportOf,
  type SessionTransport,
} from "./transport";

import type { HttpTiming } from "./timing";
import type { ResumeFile } from "./upload";
import type { LanePriority } from "./upload-lane";

/** A step waits this long for the server: its model call retries, and may be asked to repair its answer. */
export const STEP_TIMEOUT_MS = 6 * 60_000;
/** Opening a run, ending one, and the health check are quick. */
export const QUICK_TIMEOUT_MS = 20_000;
/** A file comes back whole (a résumé of a few hundred kilobytes): this, and what its size adds for a slow line. */
export const FILE_TIMEOUT_MS = 60_000;
/** How many times a look is sent when the server names pictures as missing; the last time it goes as bytes alone. */
export const PACK_ATTEMPTS = 3;
/** The response header that says how long the answer is on the wire, packed or not. */
const CONTENT_LENGTH_HEADER = "Content-Length";

/** A failed call, with the server's stable code (or ours, when the server never answered). */
export class AgentApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 0,
    /** The hashes of the pictures the server does not hold, when the code is missing_blobs. */
    readonly missing: readonly string[] = [],
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

/** Whether a failure names pictures the server does not hold, so the request goes again with them as bytes. */
function namesMissingPictures(err: unknown): err is AgentApiError {
  return err instanceof AgentApiError && err.code === AGENT_ERROR_CODE.missingBlobs;
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
  /** The run the request is for: its transport says whether the body may be packed. */
  transport?: SessionTransport;
  /** How long the answer is expected to be (a file), so a slow line is given time for it. */
  expectedBytes?: number;
};

/** A request's answer, its body already read (so the time to read it is part of the timing). */
type Answer = { response: Response; body: ArrayBuffer };

const SESSION_ID_IN_PATH = /\/sessions\/[^/?]+/;
const encoder = new TextEncoder();
const NO_HASHES: ReadonlySet<string> = new Set();

function parseJson<T>(answer: Answer): T {
  return JSON.parse(new TextDecoder().decode(answer.body)) as T;
}

function headerNumber(response: Response, name: string): number | undefined {
  const value = Number(response.headers.get(name));
  return response.headers.get(name) != null && Number.isFinite(value) ? value : undefined;
}

async function call(base: string, path: string, options: CallOptions): Promise<Answer> {
  const headers: Record<string, string> = {};
  let payload =
    options.body === undefined ? undefined : encoder.encode(JSON.stringify(options.body));
  const rawRequestBytes = payload?.byteLength ?? 0;
  if (payload) {
    headers["Content-Type"] = "application/json";
    // Packed when the server unpacks and the body is long enough to gain by it.
    if (options.transport?.can.gzip && payload.byteLength >= GZIP_MIN_BYTES) {
      payload = await gzipBytes(payload);
      headers["Content-Encoding"] = AGENT_GZIP_ENCODING;
    }
  }
  if (options.key) headers[AGENT_KEY_HEADER] = options.key;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const requestBytes = payload?.byteLength ?? 0;
  // The bytes each way are given their time on the slowest line beside the server's own.
  const timeout = AbortSignal.timeout(
    options.timeoutMs + transferAllowanceMs(requestBytes + (options.expectedBytes ?? 0)),
  );
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const timing: HttpTiming = {
    method: options.method ?? "GET",
    route: path.replace(SESSION_ID_IN_PATH, "/sessions/:id"),
    status: 0,
    startedAt: Date.now(),
    ms: 0,
    headersMs: 0,
    bodyMs: 0,
    requestBytes,
    ...(rawRequestBytes !== requestBytes ? { rawRequestBytes } : {}),
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
  // The browser unpacks a packed answer before it is read; the header says what crossed the wire.
  const wireBytes = headerNumber(response, CONTENT_LENGTH_HEADER);
  timing.responseBytes = wireBytes ?? body.byteLength;
  if (wireBytes != null && wireBytes !== body.byteLength) timing.rawResponseBytes = body.byteLength;
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
    errorBody.missing ?? [],
  );
}

/** The pictures the server holds for a run, when it keeps any. */
function heldBy(transport: SessionTransport): ReadonlySet<string> {
  return transport.can.blobs ? transport.held : NO_HASHES;
}

/**
 * Notes a picture on its way to the server, by its data URL, until the request settles either way: a
 * request made meanwhile that would carry the same picture waits for it and refers to it instead.
 */
function trackPending(transport: SessionTransport, dataUrl: string, work: Promise<unknown>): void {
  const settled = work.then(
    () => undefined,
    () => undefined,
  );
  transport.pending.set(dataUrl, settled);
  void settled.finally(() => {
    if (transport.pending.get(dataUrl) === settled) transport.pending.delete(dataUrl);
  });
}

/**
 * Opens a run. `token` is the person's Acorn session: the agent reads their profile and Library
 * from acorn-backend with it, and keeps it only for the run. A development agent that reads
 * local files ignores it. What the server offers for the run's requests is kept from the answer.
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
  const started = parseJson<AgentStarted>(response);
  rememberTransport(started.sessionId, started.transport);
  return started;
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
  const continued = parseJson<AgentContinued>(response);
  rememberTransport(sessionId, continued.transport);
  return continued;
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

/**
 * Sends a look. A picture the server holds goes as a reference, one still on its way is waited for
 * first, and the same picture twice (the screenshot that is also a survey screen) goes once. When the
 * server names pictures it no longer holds, the look goes again with them as bytes; the last time, as
 * bytes alone. The observation given keeps its data URLs: the request body is a copy.
 */
export async function sendStep(
  base: string,
  sessionId: string,
  observation: AgentObservation,
  signal: AbortSignal,
  onTiming?: CallOptions["onTiming"],
): Promise<AgentStep> {
  const transport = transportOf(sessionId);
  const first = packableObservation(observation);
  const hashes = await imageHashes(first);
  await Promise.all(first.slots.flatMap((slot) => transport.pending.get(slot.get()) ?? []));
  const held = new Set(heldBy(transport));
  for (let attempt = 0; ; attempt += 1) {
    const refs = transport.can.blobs === true && attempt < PACK_ATTEMPTS - 1;
    const packed = packImages(
      packableObservation(observation),
      hashes,
      refs ? held : NO_HASHES,
      refs,
    );
    try {
      const response = await transport.lane.run("urgent", () =>
        call(base, AGENT_ROUTES.step(sessionId), {
          method: "POST",
          body: packed.body,
          signal,
          timeoutMs: STEP_TIMEOUT_MS,
          onTiming,
          transport,
        }),
      );
      if (transport.can.blobs) for (const hash of hashes) transport.held.add(hash);
      return parseJson<AgentStep>(response);
    } catch (err) {
      if (!namesMissingPictures(err) || attempt >= PACK_ATTEMPTS - 1) throw err;
      for (const hash of err.missing) {
        held.delete(hash);
        transport.held.delete(hash);
      }
    }
  }
}

/** Asks whether a window a click opened, or a frame that appeared in the page, is an online file source, another service's sign-in or an autofill from elsewhere. */
export async function vetTarget(
  base: string,
  sessionId: string,
  target: AgentVetTarget,
  signal: AbortSignal,
  onTiming?: CallOptions["onTiming"],
): Promise<AgentVetVerdict> {
  // A few hundred bytes: it does not wait its turn on the line.
  const response = await call(base, AGENT_ROUTES.vet(sessionId), {
    method: "POST",
    body: target,
    signal,
    timeoutMs: QUICK_TIMEOUT_MS,
    onTiming,
    transport: transportOf(sessionId),
  });
  return parseJson<AgentVetVerdict>(response);
}

/** Asks the agent where the target of an action is on a screenshot taken now (the page changed shape). */
export async function locateTarget(
  base: string,
  sessionId: string,
  request: AgentLocate,
  signal: AbortSignal,
  onTiming?: CallOptions["onTiming"],
): Promise<AgentLocated> {
  const transport = transportOf(sessionId);
  // An action waits for the answer: the picture, always a new one, goes before any photo queued behind it.
  const response = await transport.lane.run("urgent", () =>
    call(base, AGENT_ROUTES.locate(sessionId), {
      method: "POST",
      body: request,
      signal,
      timeoutMs: QUICK_TIMEOUT_MS,
      onTiming,
      transport,
    }),
  );
  return parseJson<AgentLocated>(response);
}

/**
 * Sends a picture while a batch is still being carried out; the agent works on it meanwhile. The server
 * keeps it, so the look after the batch refers to it instead of carrying it again. A zone photo goes in
 * the background, behind whatever an action is waiting on; a dropdown's picture is waited on itself.
 */
export async function sendShot(
  base: string,
  sessionId: string,
  upload: AgentShotUpload,
  signal: AbortSignal,
  onTiming?: CallOptions["onTiming"],
  priority: LanePriority = "urgent",
): Promise<AgentAction[]> {
  const transport = transportOf(sessionId);
  const sending = (async (): Promise<AgentAction[]> => {
    const hashes = await imageHashes(packableShot(upload));
    for (let attempt = 0; ; attempt += 1) {
      const refs = transport.can.blobs === true && attempt === 0;
      const packed = packImages(
        packableShot(upload),
        hashes,
        refs ? heldBy(transport) : NO_HASHES,
        refs,
      );
      try {
        const answer = await transport.lane.run(priority, () =>
          call(base, AGENT_ROUTES.shots(sessionId), {
            method: "POST",
            body: packed.body,
            signal,
            timeoutMs: QUICK_TIMEOUT_MS,
            onTiming,
            transport,
          }),
        );
        if (transport.can.blobs) for (const hash of hashes) transport.held.add(hash);
        return parseJson<AgentShotAnswer>(answer).then ?? [];
      } catch (err) {
        if (!namesMissingPictures(err) || attempt > 0) throw err;
        for (const hash of err.missing) transport.held.delete(hash);
      }
    }
  })();
  trackPending(transport, upload.screenshot, sending);
  return sending;
}

/**
 * Sends a picture ahead of the look that will refer to it (a survey's screen, as soon as it is taken,
 * while the page is still being scrolled for the next), in the background. A picture the server holds
 * or is already receiving is not sent. A failure is not raised: the look then carries the picture.
 */
export function preloadImage(
  base: string,
  sessionId: string,
  dataUrl: string,
  signal: AbortSignal,
  onTiming?: CallOptions["onTiming"],
): void {
  const transport = transportOf(sessionId);
  if (!transport.can.blobs || transport.pending.has(dataUrl)) return;
  const sending = (async () => {
    const hash = await imageHash(dataUrl);
    if (transport.held.has(hash)) return;
    const body: AgentBlobsUpload = { images: [dataUrl] };
    await transport.lane.run("background", () =>
      call(base, AGENT_ROUTES.blobs(sessionId), {
        method: "POST",
        body,
        signal,
        timeoutMs: QUICK_TIMEOUT_MS,
        onTiming,
        transport,
      }),
    );
    transport.held.add(hash);
  })();
  trackPending(transport, dataUrl, sending);
}

/** Ends a run's session. A failure here changes nothing for the person, so it is not raised. */
export async function endSession(
  base: string,
  sessionId: string,
  onTiming?: CallOptions["onTiming"],
): Promise<void> {
  try {
    await call(base, AGENT_ROUTES.session(sessionId), {
      method: "DELETE",
      timeoutMs: QUICK_TIMEOUT_MS,
      onTiming,
    });
  } catch {
    // The session goes when the server forgets it; nothing to do here.
  } finally {
    forgetTransport(sessionId);
  }
}

/** Fetches a résumé file; `expectedBytes` (the size the start listed) gives a slow line time for it. */
export async function fetchResumeFile(
  base: string,
  sessionId: string,
  resumeId: string,
  fileName: string,
  signal: AbortSignal,
  toBase64: (bytes: ArrayBuffer) => string,
  onTiming?: CallOptions["onTiming"],
  expectedBytes?: number,
): Promise<ResumeFile> {
  const { response, body } = await call(base, AGENT_ROUTES.resume(sessionId, resumeId), {
    signal,
    timeoutMs: FILE_TIMEOUT_MS,
    onTiming,
    expectedBytes,
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
