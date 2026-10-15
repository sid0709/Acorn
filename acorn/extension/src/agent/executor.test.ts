import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runActions, type ExecutorContext } from "./executor.ts";
import { fakeCdp } from "./fake-cdp.ts";

import type { Overlay } from "./overlay.ts";
import type { AgentAction } from "@acorn/shared/agent-contract";

function context(options: { scale?: number; stopAfter?: number } = {}) {
  const cdp = fakeCdp();
  const moves: [number, number][] = [];
  let checks = 0;
  const ctx: ExecutorContext = {
    cdp,
    overlay: {
      moveTo: async (x: number, y: number) => void moves.push([x, y]),
      click: async () => {},
      hover: async () => {},
    } as unknown as Overlay,
    scale: () => options.scale ?? 1,
    resume: async () => ({ fileName: "r.pdf", contentType: "application/pdf", base64: "QQ==" }),
    sleep: async () => {},
    fileChooserWaitMs: 5,
    checkStopped: () => {
      checks += 1;
      if (options.stopAfter != null && checks > options.stopAfter) throw new Error("stopped");
    },
  };
  return { ctx, cdp, moves };
}

const click = (id: string, x = 100, y = 50): AgentAction => ({ id, kind: "click", x, y });

describe("runActions", () => {
  it("clicks at the screenshot point converted to page pixels, and moves the cursor there", async () => {
    const { ctx, cdp, moves } = context({ scale: 0.5 });
    const results = await runActions(ctx, [click("a", 100, 50)]);
    assert.deepEqual(results, [{ id: "a", ok: true }]);
    assert.deepEqual(moves, [[200, 100]]);
    const pressed = cdp
      .of("Input.dispatchMouseEvent")
      .find((c) => c.params?.type === "mousePressed");
    assert.deepEqual([pressed?.params?.x, pressed?.params?.y], [200, 100]);
  });

  it("types, presses keys, and reports what it typed only as a count", async () => {
    const { ctx, cdp } = context();
    const results = await runActions(ctx, [
      { id: "t", kind: "type", text: "hunter2", secret: true },
      { id: "k", kind: "key", keys: "Enter" },
    ]);
    assert.deepEqual(results, [
      { id: "t", ok: true, detail: "7 characters" },
      { id: "k", ok: true },
    ]);
    assert.ok(cdp.of("Input.dispatchKeyEvent").length > 0);
  });

  it("scrolls by the distance in page pixels", async () => {
    const { ctx, cdp } = context({ scale: 0.5 });
    await runActions(ctx, [{ id: "s", kind: "scroll", x: 10, y: 20, dx: 0, dy: 100 }]);
    const wheel = cdp.of("Input.dispatchMouseEvent").find((c) => c.params?.type === "mouseWheel");
    assert.equal(wheel?.params?.deltaY, 200);
  });

  it("stops the batch at the first failure and says what it skipped", async () => {
    const { ctx, cdp } = context();
    const results = await runActions(ctx, [click("a"), { id: "b", kind: "click" }, click("c")]);
    assert.equal(results[0].ok, true);
    assert.deepEqual(results[1], { id: "b", ok: false, error: "the action has no point" });
    assert.deepEqual(results[2], {
      id: "c",
      ok: false,
      error: "skipped: an earlier action in this step failed",
    });
    assert.equal(
      cdp.of("Input.dispatchMouseEvent").filter((c) => c.params?.type === "mousePressed").length,
      1,
    );
  });

  it("reports a protocol failure as the action's error", async () => {
    const cdp = fakeCdp({
      "Input.dispatchMouseEvent": () => {
        throw new Error("the tab is gone");
      },
    });
    const { ctx } = context();
    const results = await runActions({ ...ctx, cdp }, [click("a")]);
    assert.deepEqual(results, [{ id: "a", ok: false, error: "the tab is gone" }]);
  });

  it("uploads the résumé the server chose", async () => {
    const { ctx } = context();
    const answers = fakeCdp({
      "Runtime.evaluate": { result: { objectId: "input-1" } },
      "Runtime.callFunctionOn": { result: { value: { name: "r.pdf", size: 1 } } },
    });
    // The click opens no picker here, so the input is looked up from the point.
    const results = await runActions({ ...ctx, cdp: answers, fileChooserWaitMs: 5 }, [
      { id: "u", kind: "upload", x: 5, y: 6, resume: "data/r.pdf", fileName: "r.pdf" },
    ]);
    assert.equal(results[0].ok, true);
    assert.match(results[0].detail ?? "", /r\.pdf, 1 bytes, through the input/);
  });

  it("refuses an upload the server did not name a file for", async () => {
    const { ctx } = context();
    const results = await runActions(ctx, [{ id: "u", kind: "upload", x: 5, y: 6 }]);
    assert.match(results[0].error ?? "", /named no résumé/);
  });

  it("does not start an action after the person pressed Stop", async () => {
    const { ctx, cdp } = context({ stopAfter: 1 });
    await assert.rejects(runActions(ctx, [click("a"), click("b")]), /stopped/);
    assert.equal(
      cdp.of("Input.dispatchMouseEvent").filter((c) => c.params?.type === "mousePressed").length,
      1,
    );
  });

  it("waits for the time it was given", async () => {
    const slept: number[] = [];
    const { ctx } = context();
    const results = await runActions({ ...ctx, sleep: async (ms) => void slept.push(ms) }, [
      { id: "w", kind: "wait", ms: 1500 },
    ]);
    assert.equal(results[0].ok, true);
    assert.deepEqual(slept, [1500]);
  });
});
