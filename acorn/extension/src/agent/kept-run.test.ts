import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  forgetKeptRunOfClosedTab,
  getKeptRun,
  keepRun,
  rekeyKeptRun,
  takeKeptRun,
  type KeptRun,
} from "./kept-run.ts";

const realChrome = (globalThis as { chrome?: unknown }).chrome;

beforeEach(() => {
  const store: Record<string, unknown> = {};
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: structuredClone(store[key]) }),
        set: async (values: Record<string, unknown>) =>
          void Object.assign(store, structuredClone(values)),
      },
    },
  };
});
afterEach(() => void ((globalThis as { chrome?: unknown }).chrome = realChrome));

const run = (tabId: number, sessionId = "s1"): KeptRun => ({
  sessionId,
  runId: "r1",
  tabId,
  stopBeforeSubmit: false,
});

describe("kept runs", () => {
  it("is found from every tab the run used", async () => {
    await keepRun([1, 2], run(2));
    assert.equal((await getKeptRun(1))?.sessionId, "s1");
    assert.equal((await getKeptRun(2))?.tabId, 2);
    assert.equal(await getKeptRun(3), null);
  });

  it("is taken from every tab at once", async () => {
    await keepRun([1, 2], run(2));
    assert.equal((await takeKeptRun(1))?.sessionId, "s1");
    assert.equal(await getKeptRun(2), null);
    assert.equal(await takeKeptRun(1), null);
  });

  it("keeps runs of different tabs apart", async () => {
    await keepRun([1], run(1, "a"));
    await keepRun([2], run(2, "b"));
    assert.equal((await takeKeptRun(1))?.sessionId, "a");
    assert.equal((await getKeptRun(2))?.sessionId, "b");
  });

  it("is over when the tab it worked in closes, but not when a tab it only passed through does", async () => {
    await keepRun([1, 2], run(2));
    assert.equal(await forgetKeptRunOfClosedTab(1), null);
    assert.equal(await getKeptRun(1), null);
    assert.equal((await getKeptRun(2))?.sessionId, "s1");
    assert.equal((await forgetKeptRunOfClosedTab(2))?.sessionId, "s1");
    assert.equal(await getKeptRun(2), null);
  });

  it("follows a tab Chrome replaced", async () => {
    await keepRun([1, 2], run(2));
    await rekeyKeptRun(2, 9);
    assert.equal(await getKeptRun(2), null);
    assert.equal((await getKeptRun(9))?.tabId, 9);
    assert.equal((await getKeptRun(1))?.tabId, 9);
  });
});
