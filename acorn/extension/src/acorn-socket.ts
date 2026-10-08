import { io, type Socket } from "socket.io-client";

import {
  acornSocketOrigin,
  getAccessToken,
  getAcornApiUrl,
  ACORN_SOCKET_PATH,
} from "./auth/acorn-auth";
import { nextRetryDelay } from "./socket-backoff";

/** socket.io's own retry: first wait, cap, and ± jitter so many clients don't stampede. */
const RECONNECT_DELAY_MS = 1_000;
const RECONNECT_DELAY_MAX_MS = 30_000;
const RECONNECT_JITTER = 0.5;
const CONNECT_TIMEOUT_MS = 20_000;
/** Server-side disconnect reason; socket.io does not retry after it on its own. */
const SERVER_DISCONNECT = "io server disconnect";

export type AcornSocketHandlers = {
  onConnected: () => void;
  onDisconnected: () => void;
  onConnectError: (err: Error) => void;
  /** No session, so nothing is dialing. */
  onIdle: () => void;
  bindEvents: (socket: Socket) => void;
};

let socket: Socket | null = null;
let generation = 0;
let identity = "";
let inFlight = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
/** Our own retry, for the cases socket.io stops retrying (server kick, auth rejection). */
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

export function getAcornSocket(): Socket | null {
  return socket;
}

export function isAcornSocketConnected(): boolean {
  return Boolean(socket?.connected);
}

/**
 * Opens (or keeps) the worker's socket. `force` drops the current one and dials now,
 * skipping any backoff wait, e.g. when the network comes back.
 */
export async function connectAcornSocket(
  handlers: AcornSocketHandlers,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  const token = await getAccessToken();
  const origin = acornSocketOrigin(await getAcornApiUrl());
  const nextIdentity = token ? `${origin}|${token}` : "";

  if (!token) {
    generation += 1;
    identity = "";
    inFlight = false;
    clearRetry();
    retryAttempt = 0;
    teardown();
    handlers.onIdle();
    return;
  }

  if (
    !force &&
    identity === nextIdentity &&
    socket &&
    (socket.connected || socket.active || inFlight || retryTimer)
  ) {
    return;
  }
  if (force && socket?.connected && identity === nextIdentity) return;

  const gen = ++generation;
  inFlight = true;
  clearRetry();
  teardown();

  const next = io(origin, {
    path: ACORN_SOCKET_PATH,
    auth: { token },
    query: { type: "extension", name: "Acorn Extension" },
    transports: ["websocket", "polling"],
    upgrade: true,
    tryAllTransports: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: RECONNECT_DELAY_MS,
    reconnectionDelayMax: RECONNECT_DELAY_MAX_MS,
    randomizationFactor: RECONNECT_JITTER,
    timeout: CONNECT_TIMEOUT_MS,
    withCredentials: false,
  });

  socket = next;
  identity = nextIdentity;
  handlers.bindEvents(next);

  const current = () => gen === generation && socket === next;

  next.on("connect", () => {
    if (!current()) return;
    inFlight = false;
    retryAttempt = 0;
    handlers.onConnected();
  });
  next.on("disconnect", (reason) => {
    if (!current()) return;
    inFlight = false;
    handlers.onDisconnected();
    // Every other reason is retried by socket.io itself.
    if (reason === SERVER_DISCONNECT) scheduleRetry(handlers);
  });
  next.on("connect_error", (err) => {
    if (!current()) return;
    inFlight = false;
    // Websocket probes can 400 until host nginx upgrades /acorn/socket.io; polling may still be live.
    if (next.connected) return;
    handlers.onConnectError(err instanceof Error ? err : new Error(String(err)));
    // Inactive means the server's middleware refused us (e.g. stale token); socket.io
    // will not retry. Redial from scratch so a refreshed token is picked up.
    if (!next.active) scheduleRetry(handlers);
  });
}

export function scheduleConnectAcornSocket(handlers: AcornSocketHandlers, delayMs = 200): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void connectAcornSocket(handlers);
  }, delayMs);
}

/** Dial now if the socket is down, dropping whatever backoff wait it was in. */
export function reconnectAcornSocketNow(handlers: AcornSocketHandlers): void {
  if (isAcornSocketConnected()) return;
  retryAttempt = 0;
  void connectAcornSocket(handlers, { force: true }).catch(() => undefined);
}

function scheduleRetry(handlers: AcornSocketHandlers): void {
  clearRetry();
  const delay = nextRetryDelay(retryAttempt++, {
    baseMs: RECONNECT_DELAY_MS,
    maxMs: RECONNECT_DELAY_MAX_MS,
    jitter: RECONNECT_JITTER,
  });
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connectAcornSocket(handlers, { force: true }).catch(() => scheduleRetry(handlers));
  }, delay);
}

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function teardown(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}
