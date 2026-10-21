import { AGENT_STOP_REASON } from "@acorn/shared/agent-contract";
import { RUN_OUTCOME, type RunReport } from "@acorn/shared/run-types";
import { READY_TO_SUBMIT, describeRunFailure } from "@acorn/shared/user-messages";

import { QUEUE_ACTION } from "../agent-queue/actions";
import { parseJobLinks } from "../agent-queue/links";
import {
  QUEUE_ITEM,
  QUEUE_MODE,
  clearFinished,
  enqueue,
  isInFlight,
  itemOf,
  nextItem,
  patchItem,
  recoverInterrupted,
  removeItem,
  type QueueItem,
  type QueueState,
} from "../agent-queue/model";
import { readQueue, updateQueue } from "../agent-queue/store";
import { whenTabLoaded } from "../tab-load";

import { startRunOnTab } from "./messages/run";
import { stopRunOnTab } from "./run-stop";
import { setQueueDriving } from "./work-state";

export interface QueueCommand {
  action: string;
  text?: unknown;
  id?: unknown;
  value?: unknown;
}

export interface QueueReply {
  ok: boolean;
  error?: string;
  added?: number;
  duplicates?: number;
  invalid?: number;
  /** Links dropped because the queue is full. */
  overflow?: number;
}

/** How long a job's page gets to finish loading before the Run goes ahead on what has loaded. */
const LOAD_TIMEOUT_MS = 45_000;
/** A quiet moment after the load event, for a page that draws itself afterwards (a single-page site). */
const SETTLE_MS = 1_500;

const INTERRUPTED_NOTE =
  "The browser restarted while this job was open. Continue to start it again.";
const STOPPED_NOTE = "Stopped. Continue to take it back up.";
const PAUSED_NOTE = "Paused. Continue to take it back up.";
const TAB_CLOSED_NOTE = "Its tab was closed before the page loaded.";
const NOT_OPENED_NOTE = "Couldn’t open this link.";
const NOTHING_TO_RUN = "No jobs are waiting in the queue.";

/** Whether this worker is working through the queue (one loop at a time). */
let driving = false;
/** Jobs whose Run the person ended on purpose (Pause, Skip), so the end is not read as a block. */
const endedByPerson = new Map<string, "pause" | "skip">();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function tabExists(tabId: number | undefined): Promise<boolean> {
  if (tabId == null) return false;
  return chrome.tabs.get(tabId).then(
    () => true,
    () => false,
  );
}

/** In the words the person reads: why a Run could not finish. */
function blockNote(report: RunReport | null): string {
  if (!report) return "The run failed to start. Continue to try again.";
  if (report.outcome === RUN_OUTCOME.stopped) return STOPPED_NOTE;
  const failure = report.failure;
  if (!failure) return "The run ended before the application was sent.";
  const said = describeRunFailure(failure);
  return [failure.agentStop?.problem || said.title, failure.agentStop?.action || said.detail]
    .filter(Boolean)
    .join(" ");
}

async function patch(id: string, change: Partial<QueueItem>): Promise<void> {
  await updateQueue((state) => ({
    state: itemOf(state, id) ? patchItem(state, id, change) : state,
  }));
}

/** Brings the blocked job's tab forward so the person can see what it needs. */
async function showTab(tabId: number | undefined): Promise<void> {
  if (tabId == null) return;
  await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
}

async function closeTab(tabId: number | undefined): Promise<void> {
  if (tabId != null) await chrome.tabs.remove(tabId).catch(() => undefined);
}

/** Blocks the job and holds the queue for the person. */
async function block(id: string, note: string, tabId: number | undefined): Promise<void> {
  await updateQueue((state) => {
    if (!itemOf(state, id)) return { state };
    const mode = state.mode === QUEUE_MODE.running ? QUEUE_MODE.paused : state.mode;
    return {
      state: patchItem({ ...state, mode }, id, { status: QUEUE_ITEM.blocked, note, tabId }),
    };
  });
  await showTab(tabId);
}

/** Works one job: opens its tab (or takes the blocked one back up), runs, and settles how it ended. */
async function workOn(job: QueueItem): Promise<void> {
  endedByPerson.delete(job.id);
  const resuming = job.status === QUEUE_ITEM.blocked && (await tabExists(job.tabId));
  let tabId = resuming ? job.tabId : undefined;

  if (tabId == null) {
    await patch(job.id, { status: QUEUE_ITEM.opening, note: undefined, tabId: undefined });
    const tab = await chrome.tabs.create({ url: job.url, active: false }).catch(() => null);
    if (tab?.id == null) return block(job.id, NOT_OPENED_NOTE, undefined);
    tabId = tab.id;
    await patch(job.id, { tabId });
    if (!(await whenTabLoaded(tabId, LOAD_TIMEOUT_MS)))
      return block(job.id, TAB_CLOSED_NOTE, undefined);
    await sleep(SETTLE_MS);
  }

  // The person may have paused, skipped or removed the job while the page loaded.
  const before = await readQueue();
  const current = itemOf(before, job.id);
  if (!current) return closeTab(tabId);
  if (current.status === QUEUE_ITEM.skipped) return closeTab(tabId);
  if (before.mode !== QUEUE_MODE.running) return block(job.id, PAUSED_NOTE, tabId);

  await patch(job.id, {
    status: QUEUE_ITEM.running,
    note: undefined,
    startedAt: Date.now(),
    attempts: job.attempts + 1,
  });
  const started = await startRunOnTab(tabId, { continueRun: resuming });
  if ("error" in started) return block(job.id, started.error, tabId);
  const report = await started.done;

  const after = await readQueue();
  const why = endedByPerson.get(job.id);
  endedByPerson.delete(job.id);
  const settled = itemOf(after, job.id);
  if (!settled) return closeTab(tabId);
  if (why === "skip" || settled.status === QUEUE_ITEM.skipped) return closeTab(tabId);

  if (report?.outcome === RUN_OUTCOME.completed) {
    await patch(job.id, {
      status: QUEUE_ITEM.done,
      note: undefined,
      tabId: undefined,
      endedAt: Date.now(),
    });
    if (after.closeDone) await closeTab(tabId);
    return;
  }
  if (report?.outcome === RUN_OUTCOME.readyToSubmit) {
    // The person reviews and sends: the tab stays open, whatever the close setting says, and the
    // queue goes on to the next job.
    await patch(job.id, {
      status: QUEUE_ITEM.ready,
      note: READY_TO_SUBMIT.detail,
      tabId,
      endedAt: Date.now(),
    });
    return;
  }
  if (report?.failure?.agentStop?.reason === AGENT_STOP_REASON.jobUnavailable) {
    // Nothing to fill here: the job is finished with the reason, and the queue goes on.
    const said = describeRunFailure(report.failure);
    await patch(job.id, {
      status: QUEUE_ITEM.unavailable,
      note: [said.title, said.detail].filter(Boolean).join(". "),
      tabId: undefined,
      endedAt: Date.now(),
    });
    if (after.closeDone) await closeTab(tabId);
    return;
  }
  await block(job.id, why === "pause" ? PAUSED_NOTE : blockNote(report), tabId);
}

/** Works through the queue, one job at a time, until it is empty or the person is needed. */
async function drive(): Promise<void> {
  if (driving) return;
  driving = true;
  setQueueDriving(true);
  try {
    for (;;) {
      const state = await readQueue();
      if (state.mode !== QUEUE_MODE.running) return;
      const job = nextItem(state);
      if (!job) {
        await updateQueue((now) => ({
          state: now.mode === QUEUE_MODE.running ? { ...now, mode: QUEUE_MODE.idle } : now,
        }));
        return;
      }
      await workOn(job);
    }
  } finally {
    driving = false;
    setQueueDriving(false);
  }
}

/** The service worker started: jobs a past worker left running have no Run any more. */
export async function resumeQueueOnStart(): Promise<void> {
  await updateQueue((state) => ({ state: recoverInterrupted(state, INTERRUPTED_NOTE) }));
}

/** The job whose Run is working now, if any. */
function jobInFlight(state: QueueState): QueueItem | undefined {
  return state.items.find(isInFlight);
}

/** Ends the Run of the job working now, for a reason the person gave. */
function endRunOf(job: QueueItem | undefined, why: "pause" | "skip"): void {
  if (!job) return;
  endedByPerson.set(job.id, why);
  if (job.tabId != null) stopRunOnTab(job.tabId);
}

export async function handleQueueCommand(command: QueueCommand): Promise<QueueReply> {
  const id = typeof command.id === "string" ? command.id : "";
  switch (command.action) {
    case QUEUE_ACTION.add: {
      const text = typeof command.text === "string" ? command.text : "";
      const reply = await updateQueue<QueueReply>((state) => {
        const parsed = parseJobLinks(
          text,
          state.items.map((item) => item.url),
        );
        const { state: next, added } = enqueue(state, parsed.links, Date.now(), () =>
          crypto.randomUUID(),
        );
        return {
          state: next,
          result: {
            ok: true,
            added,
            duplicates: parsed.duplicates,
            invalid: parsed.invalid,
            overflow: parsed.links.length - added,
          },
        };
      });
      return reply ?? { ok: false };
    }
    case QUEUE_ACTION.start: {
      const started = await updateQueue<boolean>((state) =>
        nextItem(state)
          ? { state: { ...state, mode: QUEUE_MODE.running }, result: true }
          : { state, result: false },
      );
      if (!started) return { ok: false, error: NOTHING_TO_RUN };
      void drive();
      return { ok: true };
    }
    case QUEUE_ACTION.pause: {
      const state = await updateQueue<QueueState>((now) => ({
        state: { ...now, mode: now.mode === QUEUE_MODE.running ? QUEUE_MODE.paused : now.mode },
        result: now,
      }));
      endRunOf(state && jobInFlight(state), "pause");
      return { ok: true };
    }
    case QUEUE_ACTION.skip: {
      const state = await updateQueue<QueueState>((now) => ({
        state: itemOf(now, id)
          ? patchItem(now, id, {
              status: QUEUE_ITEM.skipped,
              note: undefined,
              tabId: undefined,
              endedAt: Date.now(),
            })
          : now,
        result: now,
      }));
      const job = state && itemOf(state, id);
      if (job && isInFlight(job)) endRunOf(job, "skip");
      else if (job) await closeTab(job.tabId);
      return { ok: true };
    }
    case QUEUE_ACTION.remove: {
      const state = await updateQueue<QueueState>((now) => ({
        state: removeItem(now, id),
        result: now,
      }));
      const job = state && itemOf(state, id);
      if (job && isInFlight(job)) endRunOf(job, "skip");
      return { ok: true };
    }
    case QUEUE_ACTION.clearFinished:
      await updateQueue((state) => ({ state: clearFinished(state) }));
      return { ok: true };
    case QUEUE_ACTION.closeDone:
      await updateQueue((state) => ({ state: { ...state, closeDone: command.value === true } }));
      return { ok: true };
    default:
      return { ok: false, error: "Unknown queue action" };
  }
}
