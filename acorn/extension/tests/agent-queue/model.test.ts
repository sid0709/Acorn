import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { QUEUE_MAX_ITEMS } from "../../src/agent-queue/links.ts";
import {
  EMPTY_QUEUE,
  QUEUE_ITEM,
  QUEUE_MODE,
  clearFinished,
  enqueue,
  nextItem,
  patchItem,
  queueFromStored,
  recoverInterrupted,
  tally,
  type QueueState,
} from "../../src/agent-queue/model.ts";

let counter = 0;
const newId = () => `id-${(counter += 1)}`;

function queueOf(urls: string[]): QueueState {
  return enqueue(EMPTY_QUEUE, urls, 1000, newId).state;
}

describe("the queue", () => {
  it("keeps jobs in the order they were added and works on the first waiting one", () => {
    const state = queueOf(["https://a.example.com/1", "https://a.example.com/2"]);
    assert.equal(nextItem(state)?.url, "https://a.example.com/1");
    assert.equal(tally(state).queued, 2);
  });

  it("takes a blocked job back up before the ones after it, and skips finished ones", () => {
    let state = queueOf([
      "https://a.example.com/1",
      "https://a.example.com/2",
      "https://a.example.com/3",
    ]);
    state = patchItem(state, state.items[0].id, { status: QUEUE_ITEM.done });
    state = patchItem(state, state.items[1].id, { status: QUEUE_ITEM.blocked });
    assert.equal(nextItem(state)?.url, "https://a.example.com/2");
    state = patchItem(state, state.items[1].id, { status: QUEUE_ITEM.skipped });
    assert.equal(nextItem(state)?.url, "https://a.example.com/3");
    state = patchItem(state, state.items[2].id, { status: QUEUE_ITEM.done });
    assert.equal(nextItem(state), undefined);
  });

  it("holds no more than its limit", () => {
    const urls = Array.from(
      { length: QUEUE_MAX_ITEMS + 5 },
      (_, i) => `https://a.example.com/${i}`,
    );
    const { state, added } = enqueue(EMPTY_QUEUE, urls, 1, newId);
    assert.equal(added, QUEUE_MAX_ITEMS);
    assert.equal(state.items.length, QUEUE_MAX_ITEMS);
    assert.equal(enqueue(state, ["https://b.example.com"], 1, newId).added, 0);
  });

  it("tallies what is open: everything not sent and not skipped", () => {
    let state = queueOf([
      "https://a.example.com/1",
      "https://a.example.com/2",
      "https://a.example.com/3",
    ]);
    state = patchItem(state, state.items[0].id, { status: QUEUE_ITEM.done });
    state = patchItem(state, state.items[1].id, { status: QUEUE_ITEM.skipped });
    assert.deepEqual(tally(state), {
      total: 3,
      queued: 1,
      done: 1,
      skipped: 1,
      blocked: 0,
      inFlight: 0,
      open: 1,
    });
    assert.equal(clearFinished(state).items.length, 1);
  });
});

describe("a queue found after the browser restarted", () => {
  it("blocks the jobs that were working and waits for the person", () => {
    let state = queueOf(["https://a.example.com/1", "https://a.example.com/2"]);
    state = { ...state, mode: QUEUE_MODE.running };
    state = patchItem(state, state.items[0].id, { status: QUEUE_ITEM.running, tabId: 7 });
    const recovered = recoverInterrupted(state, "interrupted");
    assert.equal(recovered.mode, QUEUE_MODE.paused);
    assert.equal(recovered.items[0].status, QUEUE_ITEM.blocked);
    assert.equal(recovered.items[0].note, "interrupted");
    assert.equal(recovered.items[1].status, QUEUE_ITEM.queued);
  });

  it("leaves a queue with nothing in flight as it is", () => {
    const state = queueOf(["https://a.example.com/1"]);
    assert.equal(recoverInterrupted(state, "x"), state);
  });
});

describe("reading the queue back from storage", () => {
  it("drops rows that are not jobs, and falls back for an unknown mode", () => {
    const state = queueFromStored({
      mode: "nonsense",
      closeDone: false,
      items: [
        { id: "1", url: "https://a.example.com", status: "queued", addedAt: 1, attempts: 0 },
        { id: 2, url: "x", status: "queued" },
        { id: "3", url: "https://b.example.com", status: "lost" },
        null,
      ],
    });
    assert.equal(state.mode, QUEUE_MODE.idle);
    assert.equal(state.closeDone, false);
    assert.deepEqual(
      state.items.map((item) => item.id),
      ["1"],
    );
  });

  it("is empty for nothing", () => {
    assert.deepEqual(queueFromStored(undefined), EMPTY_QUEUE);
  });
});
