/**
 * Gets completed Runs to acorn-backend and keeps them until it has them. A Run that ended with
 * the application sent is the one thing the website counts, so it is written to
 * `chrome.storage.local` first (it outlives the service worker and the browser) and removed only
 * when the backend answers. Sending it twice is safe: the backend keeps one row per `recordId`.
 */

import { ACORN_RUNS_API, type CompletedRunRecord } from "@acorn/shared/runs";

import { authHeaders, getAcornApiUrl, getAcornSession } from "../auth/acorn-auth";
import { withStorageLock } from "../storage-lock";

export const PENDING_RUNS_STORAGE_KEY = "acornPendingCompletedRuns";

/** The most records held while acorn-backend cannot be reached; the oldest go first. */
export const PENDING_RUNS_MAX = 200;

/** A request that takes longer is given up on and tried again at the next flush. */
const SEND_TIMEOUT_MS = 15_000;

/** A record and the account it is for: it is sent only while that account is signed in. */
export interface PendingRun {
  profileId: string;
  record: CompletedRunRecord;
}

/** What became of one record: stored, refused for good, or to be tried again. */
export type SendOutcome = "stored" | "refused" | "retry";

async function readPending(): Promise<PendingRun[]> {
  const stored = await chrome.storage.local.get(PENDING_RUNS_STORAGE_KEY);
  const raw = stored[PENDING_RUNS_STORAGE_KEY];
  return Array.isArray(raw) ? (raw as PendingRun[]) : [];
}

function writePending(pending: PendingRun[]): Promise<void> {
  return chrome.storage.local.set({ [PENDING_RUNS_STORAGE_KEY]: pending });
}

/**
 * What a response means for the record. Only a refusal of the record itself (400) is final; a
 * signed-out session, a backend that is down or not yet updated with the route (404), a busy
 * one, and a lost connection all leave it for the next try.
 */
export function outcomeOfStatus(status: number): SendOutcome {
  if (status >= 200 && status < 300) return "stored";
  if (status === 400) return "refused";
  return "retry";
}

async function send(record: CompletedRunRecord): Promise<SendOutcome> {
  try {
    const base = (await getAcornApiUrl()).replace(/\/$/, "");
    const response = await fetch(`${base}${ACORN_RUNS_API.runs}`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return outcomeOfStatus(response.status);
  } catch {
    return "retry";
  }
}

function remove(recordId: string): Promise<void> {
  return withStorageLock(PENDING_RUNS_STORAGE_KEY, async () => {
    const pending = await readPending();
    await writePending(pending.filter((held) => held.record.recordId !== recordId));
  });
}

/**
 * Sends what is waiting, oldest first, for the account that is signed in now. It stops at the
 * first record that has to wait: a backend that is down is down for the rest too.
 */
async function drain(): Promise<void> {
  const session = await getAcornSession();
  if (!session) return;
  for (const held of await readPending()) {
    if (held.profileId !== session.profileId) continue;
    const outcome = await send(held.record);
    if (outcome === "retry") return;
    if (outcome === "refused") {
      console.warn(
        "[acorn:runs] the backend refused a completed run, so it is dropped",
        held.record.recordId,
      );
    }
    await remove(held.record.recordId);
  }
}

let running: Promise<void> | null = null;
let again = false;

/**
 * Sends the completed Runs that are waiting. Calls that overlap share one pass, and a record
 * kept while it goes on is sent by a pass straight after.
 */
export function flushCompletedRuns(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await drain();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * Keeps a Run that ended with the application sent, then starts sending it. Resolves once the
 * record is safely held, not when the backend has it. Signed out, there is no account to count it for.
 */
export async function recordCompletedRun(record: CompletedRunRecord): Promise<void> {
  const session = await getAcornSession();
  if (!session) return;
  await withStorageLock(PENDING_RUNS_STORAGE_KEY, async () => {
    const pending = await readPending();
    pending.push({ profileId: session.profileId, record });
    await writePending(pending.slice(-PENDING_RUNS_MAX));
  });
  void flushCompletedRuns().catch(() => undefined);
}
