import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ACORN_RUNS_API, type CompletedRunRecord } from "@acorn/shared/runs";

import {
  PENDING_RUNS_MAX,
  PENDING_RUNS_STORAGE_KEY,
  flushCompletedRuns,
  outcomeOfStatus,
  recordCompletedRun,
  type PendingRun,
} from "../../src/agent/completed-run-sync.ts";
import { STORAGE_KEYS } from "../../src/auth/storage-keys.ts";

const API = "http://api.test";

function record(id: string): CompletedRunRecord {
  return {
    recordId: id,
    runId: "ab12cd34",
    url: "https://boards.example.com/acme/jobs/42",
    title: "Senior Engineer",
    endedAt: Date.UTC(2026, 9, 21, 12, 0, 0),
    utcOffsetMinutes: -420,
    durationMs: 93_000,
    costNanos: 21_500_000,
    steps: 19,
    modelCalls: 21,
    screenChecks: 3,
  };
}

/** chrome.storage.local, in memory. */
class FakeStorage {
  readonly data = new Map<string, unknown>();

  get(keys: string | string[]): Promise<Record<string, unknown>> {
    const wanted = typeof keys === "string" ? [keys] : keys;
    const found: Record<string, unknown> = {};
    for (const key of wanted) if (this.data.has(key)) found[key] = this.data.get(key);
    return Promise.resolve(found);
  }

  set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.data.set(key, structuredClone(value));
    return Promise.resolve();
  }

  pending(): PendingRun[] {
    return (this.data.get(PENDING_RUNS_STORAGE_KEY) as PendingRun[] | undefined) ?? [];
  }
}

type Seen = { url: string; method: string; headers: Headers; body: CompletedRunRecord };

/** A stand-in acorn-backend: it answers what the test says, in order, and remembers every request. */
class FakeBackend {
  readonly seen: Seen[] = [];
  /** Statuses to answer with, in order; once they run out it answers 201. "network" is a lost connection. */
  answers: (number | "network")[] = [];
  /** Every request fails as if the backend could not be reached. */
  down = false;
  private readonly before = globalThis.fetch;

  constructor() {
    globalThis.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const sent = typeof init?.body === "string" ? init.body : "{}";
      this.seen.push({
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: JSON.parse(sent) as CompletedRunRecord,
      });
      const next = this.down ? "network" : (this.answers.shift() ?? 201);
      if (next === "network") return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve(new Response("{}", { status: next }));
    };
  }

  restore(): void {
    globalThis.fetch = this.before;
  }

  get sentIds(): string[] {
    return this.seen.map((request) => request.body.recordId);
  }
}

describe("completed Runs on their way to acorn-backend", () => {
  let storage: FakeStorage;
  let backend: FakeBackend;
  const realChrome = (globalThis as { chrome?: unknown }).chrome;

  const signIn = (profileId: string) =>
    storage.set({
      [STORAGE_KEYS.session]: {
        accessToken: `token-${profileId}`,
        username: "j@example.com",
        displayName: "Jordan",
        profileId,
        expiresAt: "",
      },
    });

  beforeEach(async () => {
    storage = new FakeStorage();
    (globalThis as { chrome?: unknown }).chrome = { storage: { local: storage } };
    backend = new FakeBackend();
    await storage.set({ [STORAGE_KEYS.apiUrl]: API });
    await signIn("u1");
  });

  afterEach(async () => {
    await flushCompletedRuns();
    backend.restore();
    (globalThis as { chrome?: unknown }).chrome = realChrome;
  });

  /** Puts records straight into the queue, as a past session left them, so no send starts by itself. */
  const seed = (...held: PendingRun[]) => storage.set({ [PENDING_RUNS_STORAGE_KEY]: held });
  const mine = (id: string, profileId = "u1"): PendingRun => ({ profileId, record: record(id) });
  const waiting = () => storage.pending().map((held) => held.record.recordId);

  it("holds a record, sends it as the signed-in person, and lets it go once the backend has it", async () => {
    await recordCompletedRun(record("rec-1"));
    await flushCompletedRuns();

    assert.equal(backend.seen.length, 1);
    const [request] = backend.seen;
    assert.equal(request.url, `${API}${ACORN_RUNS_API.runs}`);
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("Authorization"), "Bearer token-u1");
    assert.deepEqual(request.body, record("rec-1"));
    assert.deepEqual(waiting(), []);
  });

  it("keeps a record the backend could not take, and sends it again at the next flush", async () => {
    await seed(mine("rec-1"));
    backend.answers = [503];
    await flushCompletedRuns();
    assert.deepEqual(waiting(), ["rec-1"]);

    await flushCompletedRuns();
    assert.deepEqual(backend.sentIds, ["rec-1", "rec-1"]);
    assert.deepEqual(waiting(), []);
  });

  it("keeps a record when the connection is lost", async () => {
    await seed(mine("rec-1"));
    backend.answers = ["network"];
    await flushCompletedRuns();
    assert.deepEqual(waiting(), ["rec-1"]);
    await flushCompletedRuns();
    assert.deepEqual(waiting(), []);
  });

  it("drops a record the backend refuses for good, and goes on to the next", async () => {
    await seed(mine("bad"), mine("good"));
    backend.answers = [400];
    await flushCompletedRuns();
    assert.deepEqual(backend.sentIds, ["bad", "good"]);
    assert.deepEqual(waiting(), []);
  });

  it("reads each status: stored, refused for good, or worth another try", () => {
    for (const status of [200, 201]) assert.equal(outcomeOfStatus(status), "stored");
    assert.equal(outcomeOfStatus(400), "refused");
    // A backend not yet updated with the route (404), a signed-out session (401), a busy or failing one.
    for (const status of [401, 404, 408, 429, 500, 502, 503]) {
      assert.equal(outcomeOfStatus(status), "retry", String(status));
    }
  });

  it("stops at the first record that has to wait, since a backend that is down is down for the rest", async () => {
    await seed(mine("first"), mine("second"));
    backend.answers = [503];
    await flushCompletedRuns();
    assert.deepEqual(backend.sentIds, ["first"]);
    assert.deepEqual(waiting(), ["first", "second"]);

    await flushCompletedRuns();
    assert.deepEqual(backend.sentIds, ["first", "first", "second"], "oldest first");
    assert.deepEqual(waiting(), []);
  });

  it("sends nothing when nobody is signed in, and holds nothing for no account", async () => {
    storage.data.delete(STORAGE_KEYS.session);
    await recordCompletedRun(record("rec-1"));
    await flushCompletedRuns();
    assert.equal(backend.seen.length, 0);
    assert.deepEqual(waiting(), []);
  });

  it("sends a person's records only while that person is signed in", async () => {
    await seed(mine("for-u1", "u1"));
    await signIn("u2");
    await flushCompletedRuns();
    assert.equal(backend.seen.length, 0, "u2 does not send u1's record");
    assert.deepEqual(waiting(), ["for-u1"]);

    await signIn("u1");
    await flushCompletedRuns();
    assert.deepEqual(backend.sentIds, ["for-u1"]);
    assert.equal(backend.seen[0].headers.get("Authorization"), "Bearer token-u1");
    assert.deepEqual(waiting(), []);
  });

  it("sends each of several records kept at the same moment, once", async () => {
    await Promise.all([
      recordCompletedRun(record("a")),
      recordCompletedRun(record("b")),
      recordCompletedRun(record("c")),
    ]);
    await flushCompletedRuns();
    assert.deepEqual([...backend.sentIds].sort(), ["a", "b", "c"]);
    assert.deepEqual(waiting(), []);
  });

  it("holds at most the newest records while the backend is unreachable", async () => {
    backend.down = true;
    for (let i = 0; i < PENDING_RUNS_MAX + 5; i += 1) await recordCompletedRun(record(`rec-${i}`));
    await flushCompletedRuns();
    const held = waiting();
    assert.equal(held.length, PENDING_RUNS_MAX);
    assert.equal(held[0], "rec-5");
    assert.equal(held.at(-1), `rec-${PENDING_RUNS_MAX + 4}`);
  });
});
