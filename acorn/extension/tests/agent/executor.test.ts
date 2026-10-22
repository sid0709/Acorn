import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CLICK_SETTLE_FLOOR_MS,
  SETTLE_MS,
  SKIPPED_ERROR,
  runActions,
  type ExecutorContext,
} from "../../src/agent/executor.ts";
import { NO_FOCUS_MESSAGE } from "../../src/agent/focus-guard.ts";

import { FakeElement, FakePage } from "./fake-page.ts";

/** An executor over a fake page, noting every pause the actions ask for. */
function context(extra: Partial<ExecutorContext> = {}) {
  const page = new FakePage();
  const slept: number[] = [];
  const ctx = {
    cdp: page.cdp(),
    overlay: {
      moveTo: () => Promise.resolve(),
      click: () => Promise.resolve(),
      hover: () => Promise.resolve(),
    },
    scale: () => 1,
    resume: () => Promise.reject(new Error("no résumé here")),
    sleep: (ms: number) => {
      slept.push(ms);
      return new Promise<void>((resolve) => setTimeout(resolve, 1));
    },
    checkStopped: () => undefined,
    ...extra,
  } as unknown as ExecutorContext;
  return { ctx, slept };
}

describe("the pause after an action that changes the page", () => {
  it("is the fixed time when the run cannot tell the page has settled", async () => {
    const { ctx, slept } = context();
    const results = await runActions(ctx, [{ id: "a1", kind: "click", x: 10, y: 10 }]);
    assert.equal(results[0]?.ok, true);
    assert.ok(slept.includes(SETTLE_MS), `slept ${slept.join(", ")}`);
  });

  it("is up to that time, and not less than a click needs, when the run can tell", async () => {
    const asked: [number, number | undefined][] = [];
    const { ctx, slept } = context({
      settle: (ms, floorMs) => {
        asked.push([ms, floorMs]);
        return Promise.resolve();
      },
    });
    await runActions(ctx, [
      { id: "a1", kind: "click", x: 10, y: 10 },
      { id: "a2", kind: "key", keys: "Escape" },
    ]);
    assert.deepEqual(asked, [
      [SETTLE_MS, CLICK_SETTLE_FLOOR_MS],
      [SETTLE_MS, undefined],
    ]);
    assert.ok(!slept.includes(SETTLE_MS), "the fixed pause was not slept as well");
  });

  it("is not shortened for a scroll the model asked for, which a page may answer by loading more", async () => {
    const asked: number[] = [];
    const { ctx, slept } = context({
      settle: (ms) => {
        asked.push(ms);
        return Promise.resolve();
      },
    });
    await runActions(ctx, [{ id: "a1", kind: "scroll", x: 10, y: 10, dx: 0, dy: 300 }]);
    assert.deepEqual(asked, []);
    assert.ok(slept.includes(500));
  });
});

describe("a batch after an action that failed", () => {
  it("skips what was meant for a control that was not reached, and goes on at the next control", async () => {
    // The first click lands beside its box, so nothing has focus and the typing is refused; the key
    // after it was for that box too. The next click reaches its box, and its typing goes in.
    const page = new FakePage();
    const box = new FakeElement(page, "input", { x: 10, y: 60, w: 100, h: 20 });
    let clicks = 0;
    const { ctx } = context({
      cdp: page.cdp(),
      afterClick: () => {
        clicks += 1;
        page.activeElement = clicks === 2 ? box : null;
        return Promise.resolve();
      },
    });
    const results = await runActions(ctx, [
      { id: "a1", kind: "click", x: 10, y: 10 },
      { id: "a2", kind: "type", text: "4243207354" },
      { id: "a3", kind: "key", keys: "Tab" },
      { id: "a4", kind: "click", x: 10, y: 70 },
      { id: "a5", kind: "type", text: "Fresno" },
    ]);
    assert.deepEqual(
      results.map((result) => [result.id, result.ok, result.error]),
      [
        ["a1", true, undefined],
        ["a2", false, NO_FOCUS_MESSAGE],
        ["a3", false, SKIPPED_ERROR],
        ["a4", true, undefined],
        ["a5", true, undefined],
      ],
    );
  });

  it("marks what reached no control as unreached, so the agent does not give the plan up for it", async () => {
    const page = new FakePage();
    const { ctx } = context({ cdp: page.cdp() });
    const results = await runActions(ctx, [
      { id: "a1", kind: "type", text: "Stanley" },
      { id: "a2", kind: "key", keys: "Tab" },
      { id: "a3", kind: "click", x: 10, y: 10 },
    ]);
    assert.deepEqual(
      results.map((result) => [result.id, result.ok, result.unreached]),
      [
        ["a1", false, true],
        ["a2", false, true],
        ["a3", true, undefined],
      ],
    );
  });

  it("stops at any other failure, as what follows was planned for a page that failure did not leave", async () => {
    const { ctx } = context();
    const results = await runActions(ctx, [
      { id: "a1", kind: "upload", x: 10, y: 10 },
      { id: "a2", kind: "click", x: 10, y: 70 },
      { id: "a3", kind: "type", text: "Fresno" },
    ]);
    assert.deepEqual(
      results.map((result) => [result.id, result.ok]),
      [
        ["a1", false],
        ["a2", false],
        ["a3", false],
      ],
    );
    assert.equal(results[1]?.error, SKIPPED_ERROR);
  });
});

describe("a dropdown set in one pass", () => {
  it("carries out what the agent answers its picture with before the rest of the batch", async () => {
    const order: string[] = [];
    const { ctx } = context({
      snap: (action) => {
        order.push(action.id);
        return Promise.resolve([{ id: "s1ch9", kind: "click", x: 40, y: 90 }]);
      },
      afterClick: () => Promise.resolve(),
      progress: (action, state) => {
        if (state === "started") order.push(action.id);
      },
    });
    const results = await runActions(ctx, [
      { id: "s1ch2", kind: "click", x: 40, y: 50 },
      { id: "s1ch1", kind: "snap" },
      { id: "s1a3", kind: "click", x: 40, y: 200 },
    ]);
    assert.deepEqual(
      results.map((result) => [result.id, result.ok]),
      [
        ["s1ch2", true],
        ["s1ch1", true],
        ["s1ch9", true],
        ["s1a3", true],
      ],
    );
  });
});
