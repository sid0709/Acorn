import { QUEUE_MAX_ITEMS } from "./links";

/** Where one queued job stands. */
export const QUEUE_ITEM = {
  queued: "queued",
  /** Its tab is open and loading. */
  opening: "opening",
  /** A Run works on its tab. */
  running: "running",
  /** The Run could not go on without the person (or was stopped); Continue takes it back up. */
  blocked: "blocked",
  /** The application was sent. */
  done: "done",
  /**
   * The Run stopped at the control that sends the application without pressing it: the person reviews
   * and sends it themselves, so its tab stays open. Finished, as far as the queue goes.
   */
  ready: "ready",
  /** The page showed there is no online application to make for this job; `note` says how. Finished. */
  unavailable: "unavailable",
  skipped: "skipped",
} as const;
export type QueueItemStatus = (typeof QUEUE_ITEM)[keyof typeof QUEUE_ITEM];

/** Whether the queue is working through its jobs. */
export const QUEUE_MODE = {
  /** Nothing started, or everything is finished. */
  idle: "idle",
  running: "running",
  /** Waiting for the person: a job is blocked, or they paused it. */
  paused: "paused",
} as const;
export type QueueMode = (typeof QUEUE_MODE)[keyof typeof QUEUE_MODE];

export interface QueueItem {
  id: string;
  url: string;
  status: QueueItemStatus;
  /** The tab the job is open in, while it is. */
  tabId?: number;
  /** Why it is blocked, or what ended it. */
  note?: string;
  addedAt: number;
  /** When its Run last started, and when the job ended (ms since epoch). */
  startedAt?: number;
  endedAt?: number;
  /** How many Runs it has had; a Continue counts. */
  attempts: number;
}

export interface QueueState {
  mode: QueueMode;
  items: QueueItem[];
  /** Whether a job's tab is closed once its application is sent. */
  closeDone: boolean;
}

export const EMPTY_QUEUE: QueueState = { mode: QUEUE_MODE.idle, items: [], closeDone: true };

/** Statuses that count as finished: they leave the line and can be cleared. */
const FINISHED: ReadonlySet<QueueItemStatus> = new Set([
  QUEUE_ITEM.done,
  QUEUE_ITEM.ready,
  QUEUE_ITEM.unavailable,
  QUEUE_ITEM.skipped,
]);

/** Statuses with a Run (or its tab) in flight. */
const IN_FLIGHT: ReadonlySet<QueueItemStatus> = new Set([QUEUE_ITEM.opening, QUEUE_ITEM.running]);

export function isFinished(item: QueueItem): boolean {
  return FINISHED.has(item.status);
}

export function isInFlight(item: QueueItem): boolean {
  return IN_FLIGHT.has(item.status);
}

/** Adds links at the end, up to the limit. Returns how many fit. */
export function enqueue(
  state: QueueState,
  urls: readonly string[],
  now: number,
  newId: () => string,
): { state: QueueState; added: number } {
  const room = Math.max(0, QUEUE_MAX_ITEMS - state.items.length);
  const fresh: QueueItem[] = urls.slice(0, room).map((url) => ({
    id: newId(),
    url,
    status: QUEUE_ITEM.queued,
    addedAt: now,
    attempts: 0,
  }));
  return { state: { ...state, items: [...state.items, ...fresh] }, added: fresh.length };
}

/** The job to work on next: the first one waiting, a blocked one (taken back up) before those after it. */
export function nextItem(state: QueueState): QueueItem | undefined {
  return state.items.find(
    (item) => item.status === QUEUE_ITEM.blocked || item.status === QUEUE_ITEM.queued,
  );
}

export function itemOf(state: QueueState, id: string): QueueItem | undefined {
  return state.items.find((item) => item.id === id);
}

export function patchItem(state: QueueState, id: string, patch: Partial<QueueItem>): QueueState {
  return {
    ...state,
    items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  };
}

export function removeItem(state: QueueState, id: string): QueueState {
  return { ...state, items: state.items.filter((item) => item.id !== id) };
}

export function clearFinished(state: QueueState): QueueState {
  return { ...state, items: state.items.filter((item) => !isFinished(item)) };
}

export interface QueueTally {
  total: number;
  queued: number;
  /** Applications sent. */
  done: number;
  /** Runs that stopped at the control that sends, for the person to review and send. */
  ready: number;
  /** Jobs that could not be applied to online. */
  unavailable: number;
  skipped: number;
  blocked: number;
  inFlight: number;
  /** Jobs that still have to be worked on: not finished (sent, ready, unavailable or skipped). */
  open: number;
}

export function tally(state: QueueState): QueueTally {
  const count = (status: QueueItemStatus) =>
    state.items.filter((item) => item.status === status).length;
  const done = count(QUEUE_ITEM.done);
  const ready = count(QUEUE_ITEM.ready);
  const unavailable = count(QUEUE_ITEM.unavailable);
  const skipped = count(QUEUE_ITEM.skipped);
  return {
    total: state.items.length,
    queued: count(QUEUE_ITEM.queued),
    done,
    ready,
    unavailable,
    skipped,
    blocked: count(QUEUE_ITEM.blocked),
    inFlight: state.items.filter(isInFlight).length,
    open: state.items.length - done - ready - unavailable - skipped,
  };
}

/**
 * The queue as the service worker finds it on start: a job that was opening or running lost its
 * Run with the worker, so it is blocked and the queue waits for the person to Continue.
 */
export function recoverInterrupted(state: QueueState, note: string): QueueState {
  if (!state.items.some(isInFlight)) return state;
  return {
    ...state,
    mode: QUEUE_MODE.paused,
    items: state.items.map((item) =>
      isInFlight(item) ? { ...item, status: QUEUE_ITEM.blocked, note } : item,
    ),
  };
}

/** Reads the queue back from storage, dropping anything that is not the shape written. */
export function queueFromStored(raw: unknown): QueueState {
  if (!raw || typeof raw !== "object") return EMPTY_QUEUE;
  const { mode, items, closeDone } = raw as Partial<QueueState>;
  const modes = Object.values(QUEUE_MODE) as string[];
  const statuses = Object.values(QUEUE_ITEM) as string[];
  const kept = Array.isArray(items)
    ? items.filter(
        (item): item is QueueItem =>
          !!item &&
          typeof item.id === "string" &&
          typeof item.url === "string" &&
          statuses.includes(item.status),
      )
    : [];
  return {
    mode: modes.includes(mode as string) ? (mode as QueueMode) : QUEUE_MODE.idle,
    items: kept.slice(0, QUEUE_MAX_ITEMS),
    closeDone: closeDone !== false,
  };
}
