import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CLICK_SETTLE_FLOOR_MS,
  SETTLE_MS,
  runActions,
  type ExecutorContext,
} from "../../src/agent/executor.ts";

import { FakePage } from "./fake-page.ts";

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
